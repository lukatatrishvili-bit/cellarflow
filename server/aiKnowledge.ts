import crypto from 'crypto';
import { GoogleGenAI } from '@google/genai';
import { getPrismaClientForAdmin } from './db';
import { withAiModelCallTelemetry } from './aiModelTelemetry';
import {
  AI_AGENTS,
  type AiAgentKey,
} from '../lib/ai';

export const AI_KNOWLEDGE_EMBEDDING_MODEL = (
  process.env.AI_KNOWLEDGE_EMBEDDING_MODEL || 'gemini-embedding-2'
).trim();
export const AI_KNOWLEDGE_EMBEDDING_DIMENSIONS = 768;

const MAX_DOCUMENTS_PER_ORGANIZATION = 200;
const MAX_DOCUMENT_CHARS = 100_000;
const MAX_CHUNKS_PER_DOCUMENT = 80;
const TARGET_CHUNK_CHARS = 1_400;
const CHUNK_OVERLAP_CHARS = 160;
const MAX_RETRIEVAL_CANDIDATES = 4_000;

const AGENTS = Object.keys(AI_AGENTS) as AiAgentKey[];
const AGENT_SET = new Set<string>(AGENTS);

export interface AiKnowledgeChunkInput {
  ordinal: number;
  content: string;
  searchText: string;
  tokenCount: number;
}

export interface AiKnowledgeDocumentRecord {
  id: string;
  organizationId: string;
  title: string;
  sourceLabel?: string;
  sourceUrl?: string;
  language: 'en' | 'ka';
  agents: AiAgentKey[];
  status: 'active' | 'archived';
  contentHash: string;
  chunkCount: number;
  embeddedChunkCount: number;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
  preview: string;
}

export interface AiKnowledgeSource {
  sourceRef: string;
  documentId: string;
  chunkId: string;
  title: string;
  sourceLabel?: string;
  sourceUrl?: string;
  language: 'en' | 'ka';
  agents: AiAgentKey[];
  content: string;
  score: number;
  retrieval: 'hybrid' | 'semantic' | 'lexical';
}

interface StoredChunk {
  id: string;
  organizationId: string;
  documentId: string;
  ordinal: number;
  content: string;
  searchText: string;
  tokenCount: number;
  embedding?: number[];
  embeddingModel?: string;
  createdAt: string;
}

interface StoredDocument {
  id: string;
  organizationId: string;
  title: string;
  sourceLabel?: string;
  sourceUrl?: string;
  language: 'en' | 'ka';
  agents: AiAgentKey[];
  content: string;
  contentHash: string;
  status: 'active' | 'archived';
  createdBy: string;
  createdAt: string;
  updatedAt: string;
  chunks: StoredChunk[];
}

const localDocuments = new Map<string, StoredDocument>();
let embeddingClient: GoogleGenAI | null = null;

function getEmbeddingClient(): GoogleGenAI {
  if (!embeddingClient) {
    const apiKey = (process.env.GEMINI_API_KEY || '').trim();
    if (!apiKey) throw new Error('GEMINI_API_KEY is required to generate knowledge embeddings.');
    embeddingClient = new GoogleGenAI({
      apiKey,
      httpOptions: { headers: { 'User-Agent': 'aistudio-build' } },
    });
  }
  return embeddingClient;
}

function cleanText(value: unknown): string {
  return String(value || '')
    .split(String.fromCharCode(0)).join('')
    .replace(/\r\n?/g, '\n')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function searchable(value: string): string {
  return value
    .normalize('NFKC')
    .toLocaleLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function tokens(value: string): string[] {
  return searchable(value)
    .split(' ')
    .filter((token) => token.length >= 2)
    .slice(0, 500);
}

function splitOversizedBlock(block: string): string[] {
  const pieces: string[] = [];
  let start = 0;
  while (start < block.length) {
    let end = Math.min(block.length, start + TARGET_CHUNK_CHARS);
    if (end < block.length) {
      const boundary = block.lastIndexOf(' ', end);
      if (boundary > start + TARGET_CHUNK_CHARS * 0.6) end = boundary;
    }
    const piece = block.slice(start, end).trim();
    if (piece) pieces.push(piece);
    if (end >= block.length) break;
    start = Math.max(start + 1, end - CHUNK_OVERLAP_CHARS);
  }
  return pieces;
}

/** Deterministic, language-agnostic paragraph chunking with bounded overlap. */
export function chunkAiKnowledgeText(value: string): AiKnowledgeChunkInput[] {
  const content = cleanText(value);
  if (!content) return [];
  const blocks = content
    .split(/\n\s*\n/)
    .flatMap((block) => (
      block.length > TARGET_CHUNK_CHARS
        ? splitOversizedBlock(block)
        : [block.trim()]
    ))
    .filter(Boolean);
  const chunks: string[] = [];
  let current = '';
  for (const block of blocks) {
    const candidate = current ? `${current}\n\n${block}` : block;
    if (candidate.length <= TARGET_CHUNK_CHARS) {
      current = candidate;
      continue;
    }
    if (current) chunks.push(current);
    current = block;
  }
  if (current) chunks.push(current);

  return chunks.slice(0, MAX_CHUNKS_PER_DOCUMENT).map((contentChunk, ordinal) => ({
    ordinal,
    content: contentChunk,
    searchText: searchable(contentChunk),
    tokenCount: Math.max(1, Math.ceil(contentChunk.length / 4)),
  }));
}

function normalizeAgents(value: unknown): AiAgentKey[] {
  if (!Array.isArray(value)) return [...AGENTS];
  const normalized = [...new Set(
    value
      .map((item) => String(item))
      .filter((item): item is AiAgentKey => AGENT_SET.has(item)),
  )];
  return normalized.length > 0 ? normalized : [...AGENTS];
}

function normalizeVector(value: unknown): number[] | undefined {
  if (!Array.isArray(value) || value.length < 8) return undefined;
  const vector = value.map(Number);
  if (vector.some((entry) => !Number.isFinite(entry))) return undefined;
  const norm = Math.sqrt(vector.reduce((sum, entry) => sum + entry * entry, 0));
  if (!Number.isFinite(norm) || norm <= 0) return undefined;
  return vector.map((entry) => entry / norm);
}

function cosine(left: number[], right: number[]): number {
  if (left.length !== right.length || left.length === 0) return 0;
  let result = 0;
  for (let index = 0; index < left.length; index += 1) {
    result += left[index] * right[index];
  }
  return Math.max(-1, Math.min(1, result));
}

function iso(value: unknown): string {
  const date = value instanceof Date ? value : new Date(String(value || 0));
  return Number.isNaN(date.getTime()) ? new Date(0).toISOString() : date.toISOString();
}

function normalizeChunk(value: any): StoredChunk {
  return {
    id: String(value.id),
    organizationId: String(value.organizationId),
    documentId: String(value.documentId),
    ordinal: Math.max(0, Math.floor(Number(value.ordinal) || 0)),
    content: String(value.content || ''),
    searchText: String(value.searchText || searchable(String(value.content || ''))),
    tokenCount: Math.max(0, Math.floor(Number(value.tokenCount) || 0)),
    ...(normalizeVector(value.embedding) ? { embedding: normalizeVector(value.embedding) } : {}),
    ...(typeof value.embeddingModel === 'string' && value.embeddingModel
      ? { embeddingModel: value.embeddingModel }
      : {}),
    createdAt: iso(value.createdAt),
  };
}

function normalizeDocument(value: any): StoredDocument {
  return {
    id: String(value.id),
    organizationId: String(value.organizationId),
    title: String(value.title || ''),
    ...(typeof value.sourceLabel === 'string' && value.sourceLabel
      ? { sourceLabel: value.sourceLabel }
      : {}),
    ...(typeof value.sourceUrl === 'string' && value.sourceUrl
      ? { sourceUrl: value.sourceUrl }
      : {}),
    language: value.language === 'ka' ? 'ka' : 'en',
    agents: normalizeAgents(value.agents),
    content: String(value.content || ''),
    contentHash: String(value.contentHash || ''),
    status: value.status === 'archived' ? 'archived' : 'active',
    createdBy: String(value.createdBy || ''),
    createdAt: iso(value.createdAt),
    updatedAt: iso(value.updatedAt),
    chunks: Array.isArray(value.chunks) ? value.chunks.map(normalizeChunk) : [],
  };
}

function presentDocument(document: StoredDocument): AiKnowledgeDocumentRecord {
  return {
    id: document.id,
    organizationId: document.organizationId,
    title: document.title,
    ...(document.sourceLabel ? { sourceLabel: document.sourceLabel } : {}),
    ...(document.sourceUrl ? { sourceUrl: document.sourceUrl } : {}),
    language: document.language,
    agents: document.agents,
    status: document.status,
    contentHash: document.contentHash,
    chunkCount: document.chunks.length,
    embeddedChunkCount: document.chunks.filter((chunk) => chunk.embedding).length,
    createdBy: document.createdBy,
    createdAt: document.createdAt,
    updatedAt: document.updatedAt,
    preview: document.content.replace(/\s+/g, ' ').trim().slice(0, 240),
  };
}

export function validateAiKnowledgeDocument(input: {
  title?: unknown;
  content?: unknown;
  sourceLabel?: unknown;
  sourceUrl?: unknown;
  language?: unknown;
  agents?: unknown;
}): {
  title: string;
  content: string;
  sourceLabel?: string;
  sourceUrl?: string;
  language: 'en' | 'ka';
  agents: AiAgentKey[];
} {
  const title = cleanText(input.title).replace(/\n+/g, ' ').slice(0, 160);
  const content = cleanText(input.content);
  const sourceLabel = cleanText(input.sourceLabel).replace(/\n+/g, ' ').slice(0, 200);
  const rawUrl = cleanText(input.sourceUrl).slice(0, 2_000);
  if (title.length < 3) throw new Error('Knowledge title must contain at least 3 characters.');
  if (content.length < 80) throw new Error('Knowledge content must contain at least 80 characters.');
  if (content.length > MAX_DOCUMENT_CHARS) {
    throw new Error(`Knowledge content cannot exceed ${MAX_DOCUMENT_CHARS} characters.`);
  }
  let sourceUrl: string | undefined;
  if (rawUrl) {
    try {
      const url = new URL(rawUrl);
      if (url.protocol !== 'https:') throw new Error();
      sourceUrl = url.toString();
    } catch {
      throw new Error('Knowledge source URL must be a valid HTTPS URL.');
    }
  }
  return {
    title,
    content,
    ...(sourceLabel ? { sourceLabel } : {}),
    ...(sourceUrl ? { sourceUrl } : {}),
    language: input.language === 'ka' ? 'ka' : 'en',
    agents: normalizeAgents(input.agents),
  };
}

async function generateEmbeddings(
  organizationId: string,
  contents: string[],
  taskType: 'RETRIEVAL_DOCUMENT' | 'RETRIEVAL_QUERY',
  title?: string,
): Promise<number[][]> {
  if (contents.length === 0) return [];
  return withAiModelCallTelemetry({
    organizationId,
    purpose: 'knowledge_embedding',
    model: AI_KNOWLEDGE_EMBEDDING_MODEL,
  }, async () => {
    const response = await getEmbeddingClient().models.embedContent({
      model: AI_KNOWLEDGE_EMBEDDING_MODEL,
      contents,
      config: {
        taskType,
        outputDimensionality: AI_KNOWLEDGE_EMBEDDING_DIMENSIONS,
        ...(taskType === 'RETRIEVAL_DOCUMENT' && title ? { title } : {}),
      },
    });
    const vectors = (response.embeddings || []).map((embedding) => (
      normalizeVector(embedding.values) || []
    ));
    return {
      value: vectors,
      valid: vectors.length === contents.length && vectors.every((vector) => vector.length > 0),
    };
  });
}

export async function createAiKnowledgeDocument(input: {
  organizationId: string;
  username: string;
  title: unknown;
  content: unknown;
  sourceLabel?: unknown;
  sourceUrl?: unknown;
  language?: unknown;
  agents?: unknown;
  generateEmbedding?: boolean;
  now?: Date;
}): Promise<AiKnowledgeDocumentRecord> {
  const validated = validateAiKnowledgeDocument(input);
  const chunks = chunkAiKnowledgeText(validated.content);
  if (chunks.length === 0) throw new Error('Knowledge content could not be chunked.');
  const now = input.now || new Date();
  const contentHash = crypto
    .createHash('sha256')
    .update(validated.content.normalize('NFKC'))
    .digest('hex');
  const vectors = input.generateEmbedding
    ? await generateEmbeddings(
      input.organizationId,
      chunks.map((chunk) => chunk.content),
      'RETRIEVAL_DOCUMENT',
      validated.title,
    )
    : [];
  const prisma = await getPrismaClientForAdmin();

  if (prisma) {
    const documentModel = (prisma as any).aiKnowledgeDocument;
    if (!documentModel) {
      throw new Error('AI knowledge storage is unavailable. Apply the committed database migration.');
    }
    const count = await documentModel.count({
      where: { organizationId: input.organizationId, status: 'active' },
    });
    if (count >= MAX_DOCUMENTS_PER_ORGANIZATION) {
      throw new Error(`A winery can keep at most ${MAX_DOCUMENTS_PER_ORGANIZATION} active knowledge documents.`);
    }
    const created = await (prisma as any).$transaction(async (transaction: any) => {
      const document = await transaction.aiKnowledgeDocument.create({
        data: {
          organizationId: input.organizationId,
          title: validated.title,
          sourceLabel: validated.sourceLabel || null,
          sourceUrl: validated.sourceUrl || null,
          language: validated.language,
          agents: validated.agents,
          content: validated.content,
          contentHash,
          createdBy: input.username,
          createdAt: now,
          updatedAt: now,
        },
      });
      await transaction.aiKnowledgeChunk.createMany({
        data: chunks.map((chunk, index) => ({
          id: `aikc_${crypto.randomUUID()}`,
          organizationId: input.organizationId,
          documentId: document.id,
          ...chunk,
          embedding: vectors[index]?.length ? vectors[index] : undefined,
          embeddingModel: vectors[index]?.length ? AI_KNOWLEDGE_EMBEDDING_MODEL : null,
          createdAt: now,
        })),
      });
      return transaction.aiKnowledgeDocument.findUnique({
        where: { id: document.id },
        include: { chunks: { orderBy: { ordinal: 'asc' } } },
      });
    });
    return presentDocument(normalizeDocument(created));
  }

  const activeCount = [...localDocuments.values()].filter((document) => (
    document.organizationId === input.organizationId && document.status === 'active'
  )).length;
  if (activeCount >= MAX_DOCUMENTS_PER_ORGANIZATION) {
    throw new Error(`A winery can keep at most ${MAX_DOCUMENTS_PER_ORGANIZATION} active knowledge documents.`);
  }
  if ([...localDocuments.values()].some((document) => (
    document.organizationId === input.organizationId && document.contentHash === contentHash
  ))) {
    const duplicate = new Error('This knowledge content already exists in the winery.');
    (duplicate as Error & { code?: string }).code = 'P2002';
    throw duplicate;
  }
  const id = `aikd_${crypto.randomUUID()}`;
  const timestamp = now.toISOString();
  const document: StoredDocument = {
    id,
    organizationId: input.organizationId,
    ...validated,
    contentHash,
    status: 'active',
    createdBy: input.username,
    createdAt: timestamp,
    updatedAt: timestamp,
    chunks: chunks.map((chunk, index) => ({
      id: `aikc_${crypto.randomUUID()}`,
      organizationId: input.organizationId,
      documentId: id,
      ...chunk,
      ...(vectors[index]?.length ? {
        embedding: vectors[index],
        embeddingModel: AI_KNOWLEDGE_EMBEDDING_MODEL,
      } : {}),
      createdAt: timestamp,
    })),
  };
  localDocuments.set(id, document);
  return presentDocument(document);
}

export async function listAiKnowledgeDocuments(
  organizationId: string,
  includeArchived = false,
): Promise<AiKnowledgeDocumentRecord[]> {
  const prisma = await getPrismaClientForAdmin();
  if (prisma) {
    const model = (prisma as any).aiKnowledgeDocument;
    if (!model) throw new Error('AI knowledge storage is unavailable.');
    const rows = await model.findMany({
      where: {
        organizationId,
        ...(includeArchived ? {} : { status: 'active' }),
      },
      include: { chunks: { select: { id: true, embedding: true } } },
      orderBy: { updatedAt: 'desc' },
    });
    return rows.map(normalizeDocument).map(presentDocument);
  }
  return [...localDocuments.values()]
    .filter((document) => (
      document.organizationId === organizationId
      && (includeArchived || document.status === 'active')
    ))
    .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
    .map(presentDocument);
}

/** Archive keeps provenance recoverable while immediately removing it from retrieval. */
export async function archiveAiKnowledgeDocument(
  organizationId: string,
  documentId: string,
  now = new Date(),
): Promise<boolean> {
  const prisma = await getPrismaClientForAdmin();
  if (prisma) {
    const model = (prisma as any).aiKnowledgeDocument;
    if (!model) throw new Error('AI knowledge storage is unavailable.');
    const result = await model.updateMany({
      where: { id: documentId, organizationId, status: 'active' },
      data: { status: 'archived', updatedAt: now },
    });
    return result.count === 1;
  }
  const document = localDocuments.get(documentId);
  if (!document || document.organizationId !== organizationId || document.status !== 'active') {
    return false;
  }
  document.status = 'archived';
  document.updatedAt = now.toISOString();
  return true;
}

export async function embedAiKnowledgeDocument(
  organizationId: string,
  documentId: string,
  now = new Date(),
): Promise<AiKnowledgeDocumentRecord | null> {
  const prisma = await getPrismaClientForAdmin();
  if (prisma) {
    const model = (prisma as any).aiKnowledgeDocument;
    if (!model) throw new Error('AI knowledge storage is unavailable.');
    const documentValue = await model.findFirst({
      where: { id: documentId, organizationId, status: 'active' },
      include: { chunks: { orderBy: { ordinal: 'asc' } } },
    });
    if (!documentValue) return null;
    const document = normalizeDocument(documentValue);
    const vectors = await generateEmbeddings(
      organizationId,
      document.chunks.map((chunk) => chunk.content),
      'RETRIEVAL_DOCUMENT',
      document.title,
    );
    if (
      vectors.length !== document.chunks.length
      || vectors.some((vector) => vector.length === 0)
    ) {
      throw new Error('Embedding provider did not return every document chunk.');
    }
    await (prisma as any).$transaction([
      ...document.chunks.map((chunk, index) => (
        (prisma as any).aiKnowledgeChunk.update({
          where: { id: chunk.id },
          data: {
            embedding: vectors[index],
            embeddingModel: AI_KNOWLEDGE_EMBEDDING_MODEL,
          },
        })
      )),
      model.update({
        where: { id: documentId },
        data: { updatedAt: now },
      }),
    ]);
    const updated = await model.findUnique({
      where: { id: documentId },
      include: { chunks: { orderBy: { ordinal: 'asc' } } },
    });
    return presentDocument(normalizeDocument(updated));
  }

  const document = localDocuments.get(documentId);
  if (!document || document.organizationId !== organizationId || document.status !== 'active') {
    return null;
  }
  const vectors = await generateEmbeddings(
    organizationId,
    document.chunks.map((chunk) => chunk.content),
    'RETRIEVAL_DOCUMENT',
    document.title,
  );
  if (
    vectors.length !== document.chunks.length
    || vectors.some((vector) => vector.length === 0)
  ) {
    throw new Error('Embedding provider did not return every document chunk.');
  }
  document.chunks = document.chunks.map((chunk, index) => ({
    ...chunk,
    embedding: vectors[index],
    embeddingModel: AI_KNOWLEDGE_EMBEDDING_MODEL,
  }));
  document.updatedAt = now.toISOString();
  return presentDocument(document);
}

export async function hasActiveAiKnowledge(organizationId: string): Promise<boolean> {
  const prisma = await getPrismaClientForAdmin();
  if (prisma) {
    const model = (prisma as any).aiKnowledgeDocument;
    if (!model) throw new Error('AI knowledge storage is unavailable.');
    return (await model.count({ where: { organizationId, status: 'active' } })) > 0;
  }
  return [...localDocuments.values()].some((document) => (
    document.organizationId === organizationId && document.status === 'active'
  ));
}

function lexicalScore(query: string, title: string, searchText: string): number {
  const queryTokens = [...new Set(tokens(query))];
  if (queryTokens.length === 0) return 0;
  const titleText = searchable(title);
  let matched = 0;
  let titleMatches = 0;
  for (const token of queryTokens) {
    if (searchText.includes(token)) matched += 1;
    if (titleText.includes(token)) titleMatches += 1;
  }
  const coverage = matched / queryTokens.length;
  const titleCoverage = titleMatches / queryTokens.length;
  const phraseBonus = searchText.includes(searchable(query)) ? 0.15 : 0;
  return Math.min(1, coverage * 0.75 + titleCoverage * 0.2 + phraseBonus);
}

export async function retrieveAiKnowledge(input: {
  organizationId: string;
  agent: AiAgentKey | AiAgentKey[];
  query: string;
  limit?: number;
  generateQueryEmbedding?: boolean;
}): Promise<AiKnowledgeSource[]> {
  const limit = Math.max(1, Math.min(8, Math.floor(input.limit || 4)));
  const prisma = await getPrismaClientForAdmin();
  let documents: StoredDocument[];
  if (prisma) {
    const model = (prisma as any).aiKnowledgeDocument;
    if (!model) throw new Error('AI knowledge storage is unavailable.');
    const rows = await model.findMany({
      where: { organizationId: input.organizationId, status: 'active' },
      include: {
        chunks: {
          orderBy: { ordinal: 'asc' },
          take: MAX_RETRIEVAL_CANDIDATES,
        },
      },
      orderBy: { updatedAt: 'desc' },
      take: MAX_DOCUMENTS_PER_ORGANIZATION,
    });
    documents = rows.map(normalizeDocument);
  } else {
    documents = [...localDocuments.values()].filter((document) => (
      document.organizationId === input.organizationId && document.status === 'active'
    ));
  }

  const requestedAgents = Array.isArray(input.agent) ? input.agent : [input.agent];
  const eligible = documents.filter((document) => (
    requestedAgents.some((agent) => document.agents.includes(agent))
  ));
  if (eligible.length === 0) return [];
  const hasEmbeddings = eligible.some((document) => (
    document.chunks.some((chunk) => chunk.embedding)
  ));
  let queryVector: number[] | undefined;
  if (input.generateQueryEmbedding && hasEmbeddings && (process.env.GEMINI_API_KEY || '').trim()) {
    const [generated] = await generateEmbeddings(
      input.organizationId,
      [cleanText(input.query).slice(0, 8_000)],
      'RETRIEVAL_QUERY',
    );
    queryVector = generated?.length ? generated : undefined;
  }

  const scored = eligible.flatMap((document) => document.chunks.map((chunk) => {
    const lexical = lexicalScore(input.query, document.title, chunk.searchText);
    const semantic = queryVector && chunk.embedding
      ? Math.max(0, (cosine(queryVector, chunk.embedding) + 1) / 2)
      : 0;
    const retrieval: AiKnowledgeSource['retrieval'] = queryVector && chunk.embedding
      ? (lexical > 0 ? 'hybrid' : 'semantic')
      : 'lexical';
    const score = queryVector && chunk.embedding
      ? semantic * 0.72 + lexical * 0.28
      : lexical;
    return {
      document,
      chunk,
      score,
      retrieval,
    };
  }))
    .filter((candidate) => candidate.score > 0)
    .sort((left, right) => (
      right.score - left.score
      || right.document.updatedAt.localeCompare(left.document.updatedAt)
      || left.chunk.ordinal - right.chunk.ordinal
    ))
    .slice(0, limit);

  return scored.map(({ document, chunk, score, retrieval }) => ({
    sourceRef: `knowledge:${document.id}:${chunk.id}`,
    documentId: document.id,
    chunkId: chunk.id,
    title: document.title,
    ...(document.sourceLabel ? { sourceLabel: document.sourceLabel } : {}),
    ...(document.sourceUrl ? { sourceUrl: document.sourceUrl } : {}),
    language: document.language,
    agents: document.agents,
    content: chunk.content,
    score: Math.round(score * 1_000) / 1_000,
    retrieval,
  }));
}

export function __resetInMemoryAiKnowledge(): void {
  localDocuments.clear();
  embeddingClient = null;
}
