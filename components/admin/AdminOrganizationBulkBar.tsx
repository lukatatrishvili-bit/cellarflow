import React from 'react';
import { Download, RefreshCw } from 'lucide-react';
import {
  exportAdminOrganizations,
  exportAdminUsers,
  type AdminExportOrganization,
  type AdminExportUser,
} from '../../lib/adminCsvExport';

interface Props {
  isKa: boolean;
  selectedCount: number;
  status: 'active' | 'suspended' | 'archived';
  reason: string;
  working: boolean;
  onStatusChange: (status: 'active' | 'suspended' | 'archived') => void;
  onReasonChange: (reason: string) => void;
  onApply: () => void;
}

export default function AdminOrganizationBulkBar(props: Props) {
  return (
    <div className="flex flex-wrap items-center gap-2 rounded-2xl border border-cyan-900/25 bg-[#0c090a] p-3">
      <span className="mr-auto text-[10px] font-bold text-stone-400">{props.selectedCount} {props.isKa ? 'მონიშნული' : 'selected'}</span>
      <select value={props.status} onChange={event => props.onStatusChange(event.target.value as Props['status'])} className="rounded-lg border border-stone-800 bg-stone-950 px-3 py-2 text-[10px] text-stone-300">
        <option value="active">{props.isKa ? 'გააქტიურება / აღდგენა' : 'Activate / restore'}</option>
        <option value="suspended">{props.isKa ? 'შეჩერება' : 'Suspend'}</option>
        <option value="archived">{props.isKa ? 'არქივირება' : 'Archive'}</option>
      </select>
      <input value={props.reason} onChange={event => props.onReasonChange(event.target.value)} maxLength={300} placeholder={props.isKa ? 'ცვლილების მიზეზი' : 'Reason for change'} className="min-w-52 rounded-lg border border-stone-800 bg-stone-950 px-3 py-2 text-[10px] text-stone-300 outline-none focus:border-cyan-500/30" />
      <button type="button" disabled={!props.selectedCount || props.reason.trim().length < 5 || props.working} onClick={props.onApply} className="flex items-center gap-2 rounded-lg border border-cyan-500/25 bg-cyan-950/30 px-4 py-2 text-[10px] font-bold text-cyan-300 disabled:opacity-35">
        {props.working && <RefreshCw className="h-3.5 w-3.5 animate-spin" />}{props.isKa ? 'გამოყენება' : 'Apply bulk status'}
      </button>
    </div>
  );
}

type AdminCsvExportButtonProps = {
  isKa: boolean;
} & (
  | { kind: 'users'; rows: AdminExportUser[] }
  | { kind: 'organizations'; rows: AdminExportOrganization[] }
);

export function AdminCsvExportButton(props: AdminCsvExportButtonProps) {
  const exportRows = () => {
    if (props.kind === 'users') exportAdminUsers(props.rows);
    else exportAdminOrganizations(props.rows);
  };

  const title = props.kind === 'users'
    ? (props.isKa ? 'ნაჩვენები მომხმარებლების CSV ფაილი' : 'Export the current filtered user list')
    : (props.isKa ? 'ნაჩვენები ორგანიზაციების CSV ფაილი' : 'Export the current filtered organization list');

  return (
    <button type="button" disabled={!props.rows.length} onClick={exportRows} className="inline-flex items-center gap-2 rounded-xl border border-stone-800 bg-stone-900 px-3 py-2 text-[10px] font-bold text-stone-400 transition-colors hover:border-cyan-500/30 hover:text-cyan-300 disabled:opacity-35" title={title}>
      <Download className="h-3.5 w-3.5" /> {props.isKa ? 'CSV ექსპორტი' : 'Export CSV'}
    </button>
  );
}
