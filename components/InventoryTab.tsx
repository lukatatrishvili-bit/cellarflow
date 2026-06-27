'use client';

import React, { useState, useEffect } from 'react';
import { InventoryItem } from '../lib/wineryState';
import { 
  Plus, 
  Trash2, 
  Tag, 
  Package, 
  FileText, 
  TrendingDown, 
  Scale, 
  Filter, 
  Building2, 
  DollarSign, 
  Edit3, 
  Save, 
  X,
  AlertTriangle,
  FolderPlus,
  Compass,
  CheckCircle,
  HelpCircle
} from 'lucide-react';

interface Props {
  inventory: InventoryItem[];
  onUpdateInventory: (newInv: InventoryItem[]) => void;
}

export default function InventoryTab({ inventory, onUpdateInventory }: Props) {
  // Load or initialize categories list
  const [categories, setCategories] = useState<string[]>([]);
  const [selectedCategory, setSelectedCategory] = useState<string>('yeasts');
  const [newCategoryName, setNewCategoryName] = useState<string>('');
  
  // New Item form states
  const [showItemForm, setShowItemForm] = useState(false);
  const [itemName, setItemName] = useState('');
  const [itemMinThresh, setItemMinThresh] = useState(10);
  const [itemUnit, setItemUnit] = useState('kg');
  const [itemCost, setItemCost] = useState(15.0);
  const [itemSupplier, setItemSupplier] = useState('');
  const [itemDetails, setItemDetails] = useState('');
  const [itemInitialStock, setItemInitialStock] = useState(25);

  // Editing item state
  const [editingItemId, setEditingItemId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');
  const [editStock, setEditStock] = useState(0);
  const [editMinThresh, setEditMinThresh] = useState(0);
  const [editUnit, setEditUnit] = useState('');
  const [editCost, setEditCost] = useState(0);
  const [editSupplier, setEditSupplier] = useState('');
  const [editDetails, setEditDetails] = useState('');

  // Feed with default categories on mount
  useEffect(() => {
    const savedCategories = localStorage.getItem('cf_inv_categories');
    if (savedCategories) {
      const parsed = JSON.parse(savedCategories);
      setCategories(parsed);
      if (parsed.length > 0) {
        setSelectedCategory(parsed.includes('yeasts') ? 'yeasts' : parsed[0]);
      }
    } else {
      const defaultCats = ['yeasts', 'nutritions', 'additives', 'packaging', 'bottles', 'closures', 'labels', 'boxes', 'sanitation', 'cleaning'];
      setCategories(defaultCats);
      setSelectedCategory('yeasts');
      localStorage.setItem('cf_inv_categories', JSON.stringify(defaultCats));
    }
  }, []);

  useEffect(() => {
    const inventoryCats = Array.from(new Set(inventory.map(item => item.category).filter(Boolean)));
    if (inventoryCats.length === 0) return;
    setCategories(prev => {
      const merged = Array.from(new Set([...prev, ...inventoryCats]));
      if (merged.length === prev.length) return prev;
      localStorage.setItem('cf_inv_categories', JSON.stringify(merged));
      return merged;
    });
  }, [inventory]);

  // Sync categories to localStorage
  const saveCategories = (newCats: string[]) => {
    setCategories(newCats);
    localStorage.setItem('cf_inv_categories', JSON.stringify(newCats));
  };

  // Add a new material category
  const handleAddCategory = (e: React.FormEvent) => {
    e.preventDefault();
    const cleanName = newCategoryName.trim().toLowerCase();
    if (!cleanName) return;

    if (categories.includes(cleanName)) {
      alert('This category already exists.');
      return;
    }

    const updated = [...categories, cleanName];
    saveCategories(updated);
    setSelectedCategory(cleanName);
    setNewCategoryName('');
  };

  // Delete a material category
  const handleDeleteCategory = (cat: string) => {
    const confirmDelete = window.confirm(
      `Are you sure you want to remove the category "${cat.toUpperCase()}"? All materials inside will stay in the master database but their category association will be updated to "unassigned".`
    );
    if (!confirmDelete) return;

    const updatedCats = categories.filter(c => c !== cat);
    saveCategories(updatedCats);

    // Update items belonging to it
    const updatedInv = inventory.map(item => {
      if (item.category === cat) {
        return { ...item, category: 'unassigned' };
      }
      return item;
    });
    onUpdateInventory(updatedInv);

    // Fallback selected category
    if (selectedCategory === cat) {
      setSelectedCategory(updatedCats[0] || 'unassigned');
    }
  };

  // Add new material/item
  const handleAddItem = (e: React.FormEvent) => {
    e.preventDefault();
    if (!itemName.trim()) return;

    const newItem: InventoryItem = {
      id: `inv-${Date.now()}`,
      name: itemName,
      category: selectedCategory,
      stock: itemInitialStock,
      minThreshold: itemMinThresh,
      unit: itemUnit,
      costPerUnit: itemCost,
      supplierName: itemSupplier || 'N/A',
      details: itemDetails
    };

    onUpdateInventory([...inventory, newItem]);

    // Reset Form
    setItemName('');
    setItemInitialStock(25);
    setItemMinThresh(10);
    setItemUnit('kg');
    setItemCost(15.0);
    setItemSupplier('');
    setItemDetails('');
    setShowItemForm(false);
  };

  // Save changes to edited item
  const handleSaveItemEdit = (id: string) => {
    const updated = inventory.map(item => {
      if (item.id === id) {
        return {
          ...item,
          name: editName,
          stock: editStock,
          minThreshold: editMinThresh,
          unit: editUnit,
          costPerUnit: editCost,
          supplierName: editSupplier,
          details: editDetails
        };
      }
      return item;
    });
    onUpdateInventory(updated);
    setEditingItemId(null);
  };

  // Populate editor states
  const startEditingItem = (item: InventoryItem) => {
    setEditingItemId(item.id);
    setEditName(item.name);
    setEditStock(item.stock);
    setEditMinThresh(item.minThreshold);
    setEditUnit(item.unit);
    setEditCost(item.costPerUnit);
    setEditSupplier(item.supplierName);
    setEditDetails(item.details || '');
  };

  // Delete an item
  const handleDeleteItem = (id: string, name: string) => {
    const confirmDelete = window.confirm(`Are you sure you want to delete "${name}" from your stockpile inventory? This action is irreversible.`);
    if (confirmDelete) {
      onUpdateInventory(inventory.filter(item => item.id !== id));
    }
  };

  // Adjust stock inline (+ or -)
  const adjustStockInline = (itemId: string, current: number, amount: number) => {
    const updated = inventory.map(item => {
      if (item.id === itemId) {
        return {
          ...item,
          stock: parseFloat(Math.max(0, current + amount).toFixed(1))
        };
      }
      return item;
    });
    onUpdateInventory(updated);
  };

  // Filter items in the currently active category
  const filteredItems = inventory.filter(item => item.category === selectedCategory);

  return (
    <div className="space-y-6 text-stone-800">
      
      {/* Intro section */}
      <div className="bg-white p-5 border border-[#e8dfd5] rounded-xl shadow-xs flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h2 className="text-base font-serif font-black text-[#4e0e15] flex items-center gap-2">
            <Package className="w-5 h-5 text-[#801323]" />
            Winemaker Material & Stockpile Command Center
          </h2>
          <p className="text-xs text-slate-500 mt-1">
            Track and log cellar additions, active strains, custom nutrients, glass bottle batches, and general packaging materials.
          </p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={() => setShowItemForm(!showItemForm)}
            className="px-3.5 py-1.5 text-xs font-semibold text-white bg-[#4e0e15] hover:bg-[#6b151e] rounded-lg shadow-sm transition-colors cursor-pointer flex items-center gap-1.5"
          >
            <Plus className="w-4 h-4" /> Add New Material
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        
        {/* Left column: Categories Navigation and Creation */}
        <div className="lg:col-span-3 space-y-4">
          
          <div className="bg-white p-4 border border-[#e8dfd5] rounded-xl shadow-xs space-y-4">
            <h3 className="text-xs font-mono font-bold uppercase text-slate-400 tracking-wider flex items-center justify-between border-b border-stone-100 pb-2">
              <span>Cellar Categories</span>
              <span className="text-[10px] bg-slate-100 px-1.5 py-0.2 rounded font-normal text-slate-500 font-mono">
                {categories.length} Total
              </span>
            </h3>

            {/* List of active categories */}
            <div className="space-y-1">
              {categories.map(cat => {
                const count = inventory.filter(item => item.category === cat).length;
                const isSelected = selectedCategory === cat;
                return (
                  <div 
                    key={cat} 
                    className={`flex items-center justify-between px-3 py-2 rounded-lg text-xs font-semibold transition-all group cursor-pointer ${
                      isSelected 
                        ? 'bg-[#4e0e15] text-white' 
                        : 'bg-stone-50 hover:bg-stone-100 text-stone-650'
                    }`}
                    onClick={() => setSelectedCategory(cat)}
                  >
                    <span className="capitalize truncate pr-2 flex items-center gap-1.5">
                      <span className="opacity-75">📂</span>
                      {cat.replace('_', ' ')}
                    </span>
                    <div className="flex items-center gap-1.5 shrink-0">
                      <span className={`px-1.5 py-0.2 text-[9px] font-mono rounded-full font-bold ${
                        isSelected ? 'bg-white/20 text-white' : 'bg-slate-200/60 text-slate-600'
                      }`}>
                        {count}
                      </span>
                      {/* Allow deleting categories except hardcoded ones to maintain stable fallback */}
                      {!['yeasts', 'nutritions', 'bottles'].includes(cat) && (
                        <button
                          title="Delete Category"
                          onClick={(e) => {
                            e.stopPropagation();
                            handleDeleteCategory(cat);
                          }}
                          className={`opacity-0 group-hover:opacity-100 transition-opacity p-0.5 rounded cursor-pointer hover:bg-red-900/10 ${
                            isSelected ? 'text-white hover:text-red-350' : 'text-slate-400 hover:text-red-650'
                          }`}
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
              {categories.length === 0 && (
                <p className="text-stone-400 italic text-[11px] p-2 text-center">No categories found. Create one lower down.</p>
              )}
            </div>

            {/* Add custom category form */}
            <form onSubmit={handleAddCategory} className="border-t border-dashed border-stone-250/75 pt-3 space-y-2">
              <label className="block text-[9px] font-mono font-bold uppercase text-slate-400">
                Create Custom Material Category
              </label>
              <div className="flex gap-1.5">
                <input
                  type="text"
                  placeholder="e.g. Oak Chips, Enzy"
                  value={newCategoryName}
                  onChange={(e) => setNewCategoryName(e.target.value)}
                  className="flex-1 min-w-0 px-2 py-1 text-xs border border-stone-200 rounded-lg bg-stone-50 font-medium focus:bg-white focus:border-[#4e0e15] outline-none"
                />
                <button
                  type="submit"
                  title="Add Category"
                  className="p-1 px-2.5 bg-[#4e0e15] text-white text-xs font-bold rounded-lg hover:bg-[#6b151e] shadow-xs cursor-pointer flex items-center justify-center shrink-0"
                >
                  <Plus className="w-3.5 h-3.5" />
                </button>
              </div>
            </form>
          </div>

          {/* Quick stock alert diagnostics info */}
          <div className="p-4 bg-amber-50 border border-amber-205 rounded-xl space-y-2">
            <h4 className="text-[10px] font-mono font-bold uppercase text-amber-950 flex items-center gap-1">
              <AlertTriangle className="w-3.5 h-3.5 text-amber-600" />
              Depleted Stock Warnings
            </h4>
            <div className="space-y-1.5">
              {inventory.filter(item => item.stock < item.minThreshold).map(item => (
                <div key={item.id} className="text-[11px] font-semibold text-amber-950 flex justify-between">
                  <span className="truncate pr-1">• {item.name}</span>
                  <span className="shrink-0 font-mono text-red-650 font-black">{item.stock} {item.unit}</span>
                </div>
              ))}
              {inventory.filter(item => item.stock < item.minThreshold).length === 0 && (
                <p className="text-[10px] text-amber-900/60 italic font-medium">All item balances are safely above minimum thresholds.</p>
              )}
            </div>
          </div>

        </div>

        {/* Right column: Items List, Form, & Item management */}
        <div className="lg:col-span-9 space-y-4">
          
          {/* Add Item form */}
          {showItemForm && (
            <form onSubmit={handleAddItem} className="bg-white p-5 border border-[#4e0e15] rounded-xl shadow-xs space-y-3">
              <div className="flex items-center justify-between border-b border-stone-100 pb-2">
                <h3 className="text-xs font-mono font-bold uppercase text-[#4e0e15] flex items-center gap-1.5">
                  <FolderPlus className="w-4.5 h-4.5" />
                  Adding Material under &ldquo;<span className="text-[#801323]">{selectedCategory.toUpperCase()}</span>&rdquo; Category
                </h3>
                <button 
                  type="button" 
                  onClick={() => setShowItemForm(false)}
                  className="text-stone-400 hover:text-stone-700 p-1 rounded-full cursor-pointer hover:bg-stone-100"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-12 gap-4">
                <div className="md:col-span-6">
                  <label className="block text-[10px] font-mono font-bold uppercase text-slate-500 mb-1">
                    Material / Product Name *
                  </label>
                  <input
                    type="text"
                    required
                    placeholder="e.g. Optimum-Red Active Nutrient, Go-Ferm Sterol"
                    value={itemName}
                    onChange={(e) => setItemName(e.target.value)}
                    className="w-full px-3 py-1.5 text-xs border border-stone-200 rounded bg-[#FAF8F5] font-medium focus:bg-white outline-none"
                  />
                </div>
                <div className="md:col-span-3">
                  <label className="block text-[10px] font-mono font-bold uppercase text-slate-500 mb-1">
                    Initial Stock Level
                  </label>
                  <input
                    type="number"
                    step="0.1"
                    required
                    value={itemInitialStock}
                    onChange={(e) => setItemInitialStock(parseFloat(e.target.value) || 0)}
                    className="w-full px-3 py-1.5 text-xs border border-stone-200 rounded bg-[#FAF8F5] font-mono focus:bg-white outline-none"
                  />
                </div>
                <div className="md:col-span-3">
                  <label className="block text-[10px] font-mono font-bold uppercase text-slate-500 mb-1">
                    Item Unit
                  </label>
                  <select
                    value={itemUnit}
                    onChange={(e) => setItemUnit(e.target.value)}
                    className="w-full px-3 py-1.5 text-xs border border-stone-200 rounded bg-[#FAF8F5] font-medium outline-none"
                  >
                    <option value="kg">kg (Kilogram)</option>
                    <option value="g">g (Grams)</option>
                    <option value="units">units (Individual)</option>
                    <option value="bags">bags (Bags)</option>
                    <option value="liters">liters (Liters)</option>
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-12 gap-4">
                <div className="md:col-span-4">
                  <label className="block text-[10px] font-mono font-bold uppercase text-slate-500 mb-1">
                    Min Alert Threshold
                  </label>
                  <input
                    type="number"
                    value={itemMinThresh}
                    onChange={(e) => setItemMinThresh(parseFloat(e.target.value) || 0)}
                    className="w-full px-3 py-1.5 text-xs border border-stone-200 rounded bg-[#FAF8F5] font-mono focus:bg-white outline-none"
                  />
                </div>
                <div className="md:col-span-4">
                  <label className="block text-[10px] font-mono font-bold uppercase text-slate-500 mb-1">
                    Unit Cost (Est. $)
                  </label>
                  <input
                    type="number"
                    step="0.01"
                    value={itemCost}
                    onChange={(e) => setItemCost(parseFloat(e.target.value) || 0)}
                    className="w-full px-3 py-1.5 text-xs border border-stone-200 rounded bg-[#FAF8F5] font-mono focus:bg-white outline-none"
                  />
                </div>
                <div className="md:col-span-4">
                  <label className="block text-[10px] font-mono font-bold uppercase text-slate-500 mb-1">
                    Supplier Name
                  </label>
                  <input
                    type="text"
                    value={itemSupplier}
                    onChange={(e) => setItemSupplier(e.target.value)}
                    className="w-full px-3 py-1.5 text-xs border border-stone-200 rounded bg-[#FAF8F5] font-medium focus:bg-white outline-none"
                  />
                </div>
              </div>

              <div>
                <label className="block text-[10px] font-mono font-bold uppercase text-slate-500 mb-1 flex items-center justify-between">
                  <span>Chemical Specs / Product Details & Remarks</span>
                  <span className="text-[9px] text-slate-400 font-normal">Highly recommended for yeast strains, yeast nutrients & cork lots</span>
                </label>
                <textarea
                  placeholder="Record essential specifications. For yeasts: fermentation temp range, strain characteristics, nitrogen appetite. For packages: bottle glass thickness, box weights."
                  value={itemDetails}
                  onChange={(e) => setItemDetails(e.target.value)}
                  className="w-full px-3 py-1.5 text-xs border border-stone-200 rounded bg-[#FAF8F5] focus:bg-white outline-none h-20 leading-relaxed font-serif"
                />
              </div>

              <button
                type="submit"
                className="w-full py-2 bg-[#4e0e15] hover:bg-[#6b151e] text-white text-xs font-semibold rounded-lg shadow-sm cursor-pointer transition-colors"
              >
                Assemble & Commit to Inventory Stockpile
              </button>
            </form>
          )}

          {/* Core materials header and card grid */}
          <div className="bg-white p-5 border border-[#e8dfd5] rounded-xl shadow-xs space-y-4">
            
            <div className="flex items-center justify-between border-b border-stone-100 pb-3 flex-wrap gap-2">
              <div>
                <span className="text-[10px] font-mono font-bold text-indigo-700 bg-indigo-50 px-2 py-0.5 rounded uppercase">
                  ACTIVE CATEGORY: {selectedCategory.replace('_', ' ')}
                </span>
                <h3 className="text-sm font-serif font-bold text-stone-850 mt-1">
                  Registered stockpile items
                </h3>
              </div>
              
              <span className="text-xs text-slate-500 font-mono">
                Matching items: {filteredItems.length}
              </span>
            </div>

            {/* List grid */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {filteredItems.map(item => {
                const lowStock = item.stock < item.minThreshold;
                const isEditing = editingItemId === item.id;

                if (isEditing) {
                  return (
                    <div key={item.id} className="p-4 border border-[#4e0e15] bg-[#FCFAF8] rounded-xl text-stone-800 space-y-3 shadow-xs">
                      <div className="flex items-center justify-between border-b border-stone-200 pb-2">
                        <span className="text-[10px] font-mono font-black uppercase text-[#801323]">Editing Product Specifications</span>
                        <button
                          type="button"
                          onClick={() => setEditingItemId(null)}
                          className="text-stone-400 hover:text-stone-700 p-0.5 rounded cursor-pointer"
                        >
                          <X className="w-4 h-4" />
                        </button>
                      </div>

                      <div className="space-y-2">
                        <div>
                          <label className="block text-[8px] font-mono text-slate-400 uppercase">Product Name</label>
                          <input 
                            type="text" value={editName} onChange={(e) => setEditName(e.target.value)}
                            className="w-full px-2.5 py-1 text-xs bg-white border border-stone-200 rounded font-bold"
                          />
                        </div>

                        <div className="grid grid-cols-2 gap-2">
                          <div>
                            <label className="block text-[8px] font-mono text-slate-400 uppercase">Current Stock</label>
                            <input 
                              type="number" step="0.1" value={editStock} onChange={(e) => setEditStock(parseFloat(e.target.value) || 0)}
                              className="w-full px-2.5 py-1 text-xs bg-white border border-stone-200 rounded font-mono"
                            />
                          </div>
                          <div>
                            <label className="block text-[8px] font-mono text-slate-400 uppercase">Units</label>
                            <input 
                              type="text" value={editUnit} onChange={(e) => setEditUnit(e.target.value)}
                              className="w-full px-2.5 py-1 text-xs bg-white border border-stone-200 rounded"
                            />
                          </div>
                        </div>

                        <div className="grid grid-cols-3 gap-2">
                          <div>
                            <label className="block text-[8px] font-mono text-slate-400 uppercase">Min Threshold</label>
                            <input 
                              type="number" value={editMinThresh} onChange={(e) => setEditMinThresh(parseFloat(e.target.value) || 0)}
                              className="w-full px-2.5 py-1 text-xs bg-white border border-stone-200 rounded font-mono"
                            />
                          </div>
                          <div className="col-span-2">
                            <label className="block text-[8px] font-mono text-slate-400 uppercase">Supplier</label>
                            <input 
                              type="text" value={editSupplier} onChange={(e) => setEditSupplier(e.target.value)}
                              className="w-full px-2.5 py-1 text-xs bg-white border border-stone-200 rounded"
                            />
                          </div>
                        </div>

                        <div>
                          <label className="block text-[8px] font-mono text-slate-400 uppercase">Custom Details / Winemaker Info</label>
                          <textarea 
                            value={editDetails} onChange={(e) => setEditDetails(e.target.value)}
                            className="w-full px-2.5 py-1.5 text-xs bg-white border border-stone-200 rounded h-16 leading-relaxed font-serif"
                          />
                        </div>
                      </div>

                      <div className="flex gap-2 pt-2 border-t border-stone-200 mt-2">
                        <button
                          type="button"
                          onClick={() => handleSaveItemEdit(item.id)}
                          className="flex-1 py-1 bg-emerald-700 text-white text-[11px] font-bold rounded-lg hover:bg-emerald-800 flex items-center justify-center gap-1 cursor-pointer"
                        >
                          <Save className="w-3.5 h-3.5" /> Save Specs
                        </button>
                        <button
                          type="button"
                          onClick={() => setEditingItemId(null)}
                          className="px-2.5 py-1 bg-slate-100 text-slate-600 hover:bg-slate-200 text-[11px] font-bold rounded-lg cursor-pointer"
                        >
                          Cancel
                        </button>
                      </div>
                    </div>
                  );
                }

                return (
                  <div 
                    key={item.id} 
                    className={`p-4 border rounded-xl flex flex-col justify-between hover:shadow-xs transition-shadow ${
                      lowStock 
                        ? 'bg-red-50/15 border-red-200/95' 
                        : 'bg-stone-50/50 border-[#e8dfd5]/85'
                    }`}
                  >
                    <div>
                      {/* Name & Supplier Header */}
                      <div className="flex items-start justify-between gap-1">
                        <div>
                          <h4 className="text-xs font-bold text-stone-800 line-clamp-1">{item.name}</h4>
                          <span className="text-[9px] text-slate-400 font-medium flex items-center gap-1 mt-0.5">
                            <Building2 className="w-2.5 h-2.5" />
                            {item.supplierName}
                          </span>
                        </div>
                        <div className="flex gap-1">
                          <button
                            title="Edit Material"
                            onClick={() => startEditingItem(item)}
                            className="p-1 hover:bg-stone-200 rounded text-slate-500 hover:text-stone-800 transition-colors cursor-pointer shrink-0"
                          >
                            <Edit3 className="w-3.5 h-3.5" />
                          </button>
                          <button
                            title="Delete Item"
                            onClick={() => handleDeleteItem(item.id, item.name)}
                            className="p-1 hover:bg-red-100 rounded text-slate-400 hover:text-red-700 transition-colors cursor-pointer shrink-0"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </div>

                      {/* Stock Figures */}
                      <div className="flex items-baseline gap-2 mt-2">
                        <strong className="text-lg font-serif font-black text-stone-850">
                          {item.stock} {item.unit}
                        </strong>
                        <span className="text-[9px] text-slate-405 font-mono">
                          Min Alert limit: {item.minThreshold} {item.unit}
                        </span>
                      </div>

                      {/* Details specs box to gather info */}
                      <div className="mt-2.5 p-2 bg-white/70 border border-stone-200/50 rounded-lg text-xs leading-relaxed font-serif text-stone-600 block min-h-[44px]">
                        {item.details ? (
                          <p className="line-clamp-3 text-[10.5px] italic">
                            &ldquo;{item.details}&rdquo;
                          </p>
                        ) : (
                          <p className="text-[10px] text-slate-400 italic flex items-center gap-1">
                            <HelpCircle className="w-3.5 h-3.5 opacity-60" />
                            No remarks or chemical strain specifications provided. Add details above.
                          </p>
                        )}
                      </div>
                    </div>

                    {/* Stock Refill / Reduce micro adjustments bar */}
                    <div className="mt-4 flex items-center justify-between border-t border-dashed border-[#e8dfd5] pt-2 text-[10px] gap-2">
                      {lowStock ? (
                        <span className="text-red-650 font-bold uppercase animate-pulse flex items-center gap-0.5">
                          ⚠️ LOW STOCK
                        </span>
                      ) : (
                        <span className="text-emerald-700 font-mono flex items-center gap-0.5 font-bold">
                          <CheckCircle className="w-3 h-3" /> Safe Level
                        </span>
                      )}

                      <div className="flex items-center gap-1 shrink-0">
                        <button
                          title="Consume Item (-Qty)"
                          onClick={() => adjustStockInline(item.id, item.stock, item.unit === 'units' ? -50 : -2.5)}
                          className="px-2 py-1 bg-stone-100 text-stone-700 text-[10px] font-bold rounded-lg hover:bg-stone-200 border border-stone-200 cursor-pointer"
                        >
                          - Consume
                        </button>
                        <button
                          title="Refill Stock (+Qty)"
                          onClick={() => adjustStockInline(item.id, item.stock, item.unit === 'units' ? 100 : 5)}
                          className="px-2 py-1 bg-[#4e0e15] text-white text-[10px] font-bold rounded-lg hover:bg-[#6b151e] shadow-2xs cursor-pointer flex items-center gap-0.5"
                        >
                          + Refill
                        </button>
                      </div>
                    </div>

                  </div>
                );
              })}

              {filteredItems.length === 0 && (
                <div className="col-span-2 py-12 text-center border-2 border-dashed border-[#e8dfd5] rounded-xl text-slate-400 italic font-serif">
                  <p>No materials found in the &ldquo;{selectedCategory}&rdquo; category.</p>
                  <button
                    onClick={() => setShowItemForm(true)}
                    className="mt-3 inline-flex items-center gap-1 text-xs font-semibold text-[#801323] hover:underline cursor-pointer"
                  >
                    + Register the first stockpile material here
                  </button>
                </div>
              )}
            </div>

          </div>

        </div>

      </div>

    </div>
  );
}
