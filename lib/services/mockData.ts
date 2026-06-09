export const mockData = {
  tanks: [
    {
      id: "tank-ss1",
      name: "T-101 (SS-Vert)",
      type: "stainless_steel",
      capacity: 12000,
      currentVolume: 9500,
      location: "East Wing Cellar",
      shape: "vertical",
      coolingJacket: true,
      tempControl: true,
      currentTemp: 14.2,
      status: "occupied",
      currentLotId: "lot-muk24",
      notes: "Premium tank containing the Mukuzani Saperavi lot. Temperature under strict fermentation jacket monitoring.",
      lastCleaningDate: "2026-05-10",
      lastOperationDate: "2026-05-24"
    },
    {
      id: "tank-qv2",
      name: "Q-04 (Qvevri)",
      type: "qvevri",
      capacity: 3500,
      currentVolume: 3500,
      location: "Marani (Clay Hall)",
      shape: "qvevri",
      coolingJacket: false,
      tempControl: false,
      currentTemp: 16.5,
      status: "occupied",
      currentLotId: "lot-rka24",
      notes: "Traditional Kakhemian clay amphora. Currently fully sealed on skin (Chacha) for extended maceration.",
      lastCleaningDate: "2026-04-20",
      lastOperationDate: "2026-05-25"
    },
    {
      id: "tank-conc3",
      name: "C-201 (Conical)",
      type: "concrete",
      capacity: 8000,
      currentVolume: 6200,
      location: "Fermentation Bay B",
      shape: "conical",
      coolingJacket: false,
      tempControl: true,
      currentTemp: 22.8,
      status: "fermenting",
      currentLotId: "lot-sap24",
      notes: "Concrete tank optimizing thermal storage. Saperavi fermentation lot active with spontaneous yeast inoculations.",
      lastCleaningDate: "2026-05-18",
      lastOperationDate: "2026-05-26"
    },
    {
      id: "tank-bar4",
      name: "B-Oak-42 (French)",
      type: "barrel",
      capacity: 225,
      currentVolume: 225,
      location: "Wood Aging Cellar",
      shape: "barrel",
      coolingJacket: false,
      tempControl: false,
      currentTemp: 15.0,
      status: "occupied",
      currentLotId: "lot-shv24",
      notes: "Toast Medium-Plus. Currently aging a premium Shavkapito Red.",
      lastCleaningDate: "2026-03-01",
      lastOperationDate: "2026-05-15"
    },
    {
      id: "tank-ss5",
      name: "T-102 (SS-Var)",
      type: "stainless_steel",
      capacity: 5000,
      currentVolume: 0,
      location: "East Wing Cellar",
      shape: "variable_capacity",
      coolingJacket: true,
      tempControl: false,
      currentTemp: 18.0,
      status: "empty",
      currentLotId: "",
      notes: "Cleaned and sanitized variable capacity tank. Ready for blending assembly or racking.",
      lastCleaningDate: "2026-05-25",
      lastOperationDate: "2026-05-25"
    }
  ],

  lots: [
    {
      id: "lot-muk24",
      code: "L-MUK24",
      wineName: "Mukuzani Select Saperavi",
      vintage: 2024,
      variety: "Saperavi",
      vineyard: "Kondoli Block D",
      region: "Mukuzani Appellation (Kakheti)",
      harvestDate: "2024-09-12",
      grapeQuantity: 15000,
      initialVolume: 10200,
      currentVolume: 9500,
      type: "red",
      productionMethod: "Traditional Kakhemian Barrel Maturation",
      stage: "aging",
      tanks: ["tank-ss1"],
      responsibleWinemaker: "Luka Tatrishvili",
      notes: "Stunning rich deep ruby color. Dark chocolate and blackberry notes. Undergoing active barrel transfer tests."
    },
    {
      id: "lot-rka24",
      code: "L-RKA24",
      wineName: "Rkatsiteli Marani Amber",
      vintage: 2024,
      variety: "Rkatsiteli",
      vineyard: "Tsinandali Block F",
      region: "Tsinandali Microzone",
      harvestDate: "2024-09-20",
      grapeQuantity: 6000,
      initialVolume: 3500,
      currentVolume: 3500,
      type: "amber",
      productionMethod: "6 Months Skin Contact in Sealed Soil Qvevris",
      stage: "maceration",
      tanks: ["tank-qv2"],
      responsibleWinemaker: "Luka Tatrishvili",
      notes: "Exceptional tannins, dried apricot and warm honeyed nose. Qvevri is sealed. Skin contact terminates next week."
    },
    {
      id: "lot-sap24",
      code: "L-SAP24",
      wineName: "Saperavi Spontaneous Wild",
      vintage: 2025,
      variety: "Saperavi",
      vineyard: "Kindzmarauli Block A",
      region: "Kindzmarauli Appellation",
      harvestDate: "2025-09-02",
      grapeQuantity: 9000,
      initialVolume: 6200,
      currentVolume: 6200,
      type: "red",
      productionMethod: "Spontaneous controlled concrete fermentation",
      stage: "fermentation",
      tanks: ["tank-conc3"],
      responsibleWinemaker: "Ana Cholokashvili",
      notes: "Active alcoholic fermentation. Primary target is fermentation dryness. Fermentation tracking curves active."
    },
    {
      id: "lot-shv24",
      code: "L-SHV24",
      wineName: "Shavkapito Reserve Red",
      vintage: 2024,
      variety: "Shavkapito",
      vineyard: "Mukhrani slopes",
      region: "Kartli",
      harvestDate: "2024-10-02",
      grapeQuantity: 400,
      initialVolume: 240,
      currentVolume: 225,
      type: "red",
      productionMethod: "Classic Oak aging",
      stage: "aging",
      tanks: ["tank-bar4"],
      responsibleWinemaker: "Luka Tatrishvili",
      notes: "Highly elegant light red grape variety from Kartli. Light tannins, spice nose, aged inside French Oak barrel B-Oak-42."
    }
  ],

  transfers: [
    {
      id: "tx-1",
      date: "2026-05-15T10:00:00Z",
      sourceTankId: "tank-ss5",
      destTankId: "tank-ss1",
      lotId: "lot-muk24",
      volume: 4500,
      lossVolume: 20,
      reason: "racking",
      pump: "Rover Pompa 40",
      operator: "Merab Japaridze",
      notes: "Racked separating primary heavy lees. Wine is highly clarified."
    },
    {
      id: "tx-2",
      date: "2026-05-24T14:30:00Z",
      sourceTankId: "tank-ss1",
      destTankId: "tank-bar4",
      lotId: "lot-shv24",
      volume: 240,
      lossVolume: 15,
      reason: "aging_barrel",
      pump: "Gravity Flow",
      operator: "Luka Tatrishvili",
      notes: "Moved from stainless micro-tank inside French Oak B-Oak-42, packing maximum barrel allocation."
    }
  ],

  fermentations: [
    {
      id: "ferm-sap",
      lotId: "lot-sap24",
      tankId: "tank-conc3",
      startDate: "2026-05-18",
      yeast: "Wild Yeast (Spontaneous)",
      type: "spontaneous",
      initialSugar: 24.5, // Brix
      tempRange: "20-25°C",
      targetDryness: 1.5, // g/L residual sugar
      status: "active",
      notes: "Healthy wild fermentation active. Checking daily sugar depletion and temperature spike control."
    }
  ],

  fermentationLogs: [
    {
      id: "flog-1",
      fermentationId: "ferm-sap",
      date: "2026-05-19",
      temp: 20.1,
      density: 1.095,
      sugar: 23.0,
      pH: 3.52,
      notes: "Slight carbon dioxide fizz detected. Cap starting to lift. Pushed down twice.",
      capManagement: "Punchdown twice",
      additions: "None",
      problems: "None",
      responsiblePerson: "Ana Cholokashvili"
    },
    {
      id: "flog-2",
      fermentationId: "ferm-sap",
      date: "2026-05-21",
      temp: 22.4,
      density: 1.070,
      sugar: 18.2,
      pH: 3.50,
      notes: "Vigorous fermentation. Strong heat dissipation. Cooling system verified and cooling jacket activated.",
      capManagement: "Pumpover for 15 mins",
      additions: "DAP Nutrient (150g)",
      problems: "None",
      responsiblePerson: "Ana Cholokashvili"
    },
    {
      id: "flog-3",
      fermentationId: "ferm-sap",
      date: "2026-05-23",
      temp: 24.1,
      density: 1.045,
      sugar: 11.5,
      pH: 3.48,
      notes: "Cap is highly active. Aromatics are rich and fruity. No volatile sulfur off-odors.",
      capManagement: "Punchdown twice and pumpover once",
      additions: "None",
      problems: "None",
      responsiblePerson: "Merab Japaridze"
    },
    {
      id: "flog-4",
      fermentationId: "ferm-sap",
      date: "2026-05-25",
      temp: 23.5,
      density: 1.020,
      sugar: 5.0,
      pH: 3.46,
      notes: "Fermentation progressing smoothly. Getting close to target dryness.",
      capManagement: "Punchdown once",
      additions: "None",
      problems: "None",
      responsiblePerson: "Ana Cholokashvili"
    },
    {
      id: "flog-5",
      fermentationId: "ferm-sap",
      date: "2026-05-26",
      temp: 22.8,
      density: 1.010,
      sugar: 2.5,
      pH: 3.45,
      notes: "Active yeast activity slowing down naturally as sugar is depleted. On-track for final dry-out.",
      capManagement: "Light bubble-over",
      additions: "None",
      problems: "None",
      responsiblePerson: "Luka Tatrishvili"
    }
  ],

  labResults: [
    {
      id: "lab-m1",
      lotId: "lot-muk24",
      tankId: "tank-ss1",
      date: "2026-04-15",
      alcohol: 13.5,
      pH: 3.48,
      totalAcidity: 6.2,
      volatileAcidity: 0.35,
      freeSO2: 45,
      totalSO2: 95,
      residualSugar: 2.5,
      density: 0.995,
      tastingNote: "Post-fermentation fresh dark fruit characters. Active integration.",
      technician: "Ekaterine Melikidze"
    },
    {
      id: "lab-m2",
      lotId: "lot-muk24",
      tankId: "tank-ss1",
      date: "2026-05-01",
      alcohol: 13.6,
      pH: 3.52,
      totalAcidity: 6.0,
      volatileAcidity: 0.38,
      freeSO2: 38,
      totalSO2: 90,
      residualSugar: 2.1,
      density: 0.994,
      tastingNote: "Oaked notes emerging. Moderate velvety texture, tannin softening.",
      technician: "Ekaterine Melikidze"
    },
    {
      id: "lab-m3",
      lotId: "lot-muk24",
      tankId: "tank-ss1",
      date: "2026-05-15",
      alcohol: 13.7,
      pH: 3.55,
      totalAcidity: 5.9,
      volatileAcidity: 0.40,
      freeSO2: 34,
      totalSO2: 88,
      residualSugar: 1.9,
      density: 0.993,
      tastingNote: "Round structure, well-defined black currant flavor profile.",
      technician: "Ekaterine Melikidze"
    },
    {
      id: "lab-1",
      lotId: "lot-muk24",
      tankId: "tank-ss1",
      date: "2026-05-24",
      alcohol: 13.8,
      pH: 3.58,
      totalAcidity: 5.9,
      volatileAcidity: 0.42,
      freeSO2: 32,
      totalSO2: 85,
      residualSugar: 1.8,
      density: 0.993,
      tastingNote: "Deep color intensity. Bold tannins present with exceptional cherry tones. Perfect Free SO2 levels.",
      technician: "Ekaterine Melikidze"
    },
    {
      id: "lab-r1",
      lotId: "lot-rka24",
      tankId: "tank-qv2",
      date: "2026-04-20",
      alcohol: 12.2,
      pH: 3.32,
      totalAcidity: 6.5,
      volatileAcidity: 0.30,
      freeSO2: 25,
      totalSO2: 65,
      residualSugar: 1.8,
      density: 0.992,
      tastingNote: "Freshly decanted from skins. Highly aromatic amber profiles.",
      technician: "Ekaterine Melikidze"
    },
    {
      id: "lab-r2",
      lotId: "lot-rka24",
      tankId: "tank-qv2",
      date: "2026-05-05",
      alcohol: 12.3,
      pH: 3.35,
      totalAcidity: 6.4,
      volatileAcidity: 0.34,
      freeSO2: 20,
      totalSO2: 58,
      residualSugar: 1.5,
      density: 0.992,
      tastingNote: "Hazelnut and beeswax elements starting to focus. Excellent dry grip.",
      technician: "Ekaterine Melikidze"
    },
    {
      id: "lab-r3",
      lotId: "lot-rka24",
      tankId: "tank-qv2",
      date: "2026-05-18",
      alcohol: 12.4,
      pH: 3.38,
      totalAcidity: 6.3,
      volatileAcidity: 0.36,
      freeSO2: 17,
      totalSO2: 52,
      residualSugar: 1.3,
      density: 0.991,
      tastingNote: "Subtle complex smoke, honeyed apricot aroma, structural precision.",
      technician: "Ekaterine Melikidze"
    },
    {
      id: "lab-2",
      lotId: "lot-rka24",
      tankId: "tank-qv2",
      date: "2026-05-25",
      alcohol: 12.5,
      pH: 3.42,
      totalAcidity: 6.2,
      volatileAcidity: 0.38,
      freeSO2: 15,
      totalSO2: 50,
      residualSugar: 1.2,
      density: 0.991,
      tastingNote: "Magnificent amber clarity. Walnut, almond, and dried pear aromas. High natural skin tannins.",
      technician: "Ekaterine Melikidze"
    }
  ],

  inventory: [
    {
      id: "inv-kmbs",
      name: "Potassium Metabisulfite (KMBS)",
      category: "Additives",
      supplier: "Scherer Enology France",
      quantity: 45.5,
      unit: "kg",
      minStock: 10,
      costPerUnit: 12.0,
      expirationDate: "2028-09-01",
      storageLocation: "Chemical Cold room"
    },
    {
      id: "inv-yeast-qa23",
      name: "Lalvin QA23 Yeasts",
      category: "Yeasts",
      supplier: "Lallemand Corp",
      quantity: 12.0,
      unit: "kg",
      minStock: 2,
      costPerUnit: 45.0,
      expirationDate: "2027-12-15",
      storageLocation: "Chemical Cold room"
    },
    {
      id: "inv-bottles",
      name: "Burgundy Glass Bottles 0.75L",
      category: "Bottles",
      supplier: "Vetri Speciali Italy",
      quantity: 18500,
      unit: "units",
      minStock: 5000,
      costPerUnit: 0.85,
      expirationDate: "N/A",
      storageLocation: "Warehouse Block C"
    },
    {
      id: "inv-corks-nat",
      name: "Natural Corks Super-Grade",
      category: "Corks/stoppers",
      supplier: "Amorim Portugal",
      quantity: 4200,
      unit: "units",
      minStock: 1000,
      costPerUnit: 0.65,
      expirationDate: "2029-01-01",
      storageLocation: "Dry Box Storage"
    },
    {
      id: "inv-caustics",
      name: "Caustic Soda Cleaner 30%",
      category: "Cleaning products",
      supplier: "Winery Hygiene Ltd",
      quantity: 180,
      unit: "L",
      minStock: 50,
      costPerUnit: 4.8,
      expirationDate: "2027-05-01",
      storageLocation: "Chemical Cabin 2"
    }
  ],

  additives: [
    {
      id: "add-1",
      lotId: "lot-muk24",
      tankId: "tank-ss1",
      date: "2026-05-24",
      productName: "Potassium Metabisulfite (KMBS)",
      productType: "SO2",
      dose: "4 g/hL",
      totalAmount: 380, // 380 grams
      operator: "Luka Tatrishvili",
      notes: "Post-racking SO2 correction to reach target free sulfur boundaries."
    }
  ],

  bottlings: [
    {
      id: "bot-1",
      date: "2026-05-10",
      lotId: "lot-muk24",
      sourceTankId: "tank-ss1",
      volume: 600,
      bottleSize: "0.75 L",
      bottleCount: 800,
      bottleType: "Burgundy Antique Green",
      closureType: "natural_cork",
      capsuleType: "Aluminium Bordeaux Matte Red",
      labelVersion: "Mukuzani Estate Label V2",
      boxSize: 6,
      operator: "Merab Japaridze",
      notes: "First micro-bottling run for trade partners. Excellent seal verification on lines."
    }
  ],

  barrels: [
    {
      id: "B-Oak-42",
      volume: 225,
      cooper: "Seguin Moreau",
      oakOrigin: "Allier French Oak",
      toastLevel: "Medium Plus",
      purchaseYear: 225,
      fillsCount: 2,
      currentLotId: "lot-shv24",
      location: "Cellar Row 3",
      notes: "Highly valuable Seguin barrel optimized for soft red tannic integration."
    }
  ],

  qvevris: [
    {
      id: "Q-04",
      volume: 3500,
      location: "Kakheti Marani (Buried Room 1)",
      isBuried: true,
      waxLimeStatus: "Polished beeswax coating verified in August 2025",
      currentLotId: "lot-rka24",
      skinContactDuration: "6 Months",
      notes: "Traditional amphora buried in fertile soil. No structural hairline leaks detected."
    }
  ],

  cleanings: [
    {
      id: "clean-1",
      date: "2026-05-25",
      equipmentId: "tank-ss5",
      equipmentType: "tank",
      method: "Caustic flush + Citric neutralization rinse",
      productUsed: "Caustic Soda + Citric Acid",
      concentration: "2.5% Caustic / 1% Citric",
      operator: "Merab Japaridze",
      notes: "Vessel fully sanitized. Air-dried and sealed under passive carbon dioxide layer."
    }
  ],

  tasks: [
    {
      id: "task-1",
      title: "Check Saperavi concrete fermentation Brix & Temp",
      relatedType: "fermentation",
      relatedId: "ferm-sap",
      dueDate: "2026-05-27",
      priority: "critical",
      assignedTo: "Ana Cholokashvili",
      status: "pending",
      notes: "Check sugar level daily to avoid refrigeration drops or stuck states."
    },
    {
      id: "task-2",
      title: "Perform Free SO2 analysis on Tank-101",
      relatedType: "lot",
      relatedId: "lot-muk24",
      dueDate: "2026-05-28",
      priority: "high",
      assignedTo: "Ekaterine Melikidze",
      status: "pending",
      notes: "Verify if sulfur limits stabilized after KMBS addition on May 24."
    },
    {
      id: "task-3",
      title: "Clean French Oak barrel B-Oak-12",
      relatedType: "barrel",
      relatedId: "B-Oak-12",
      dueDate: "2026-05-29",
      priority: "medium",
      assignedTo: "Merab Japaridze",
      status: "pending",
      notes: "Preparation for upcoming Shavkapito racking run."
    }
  ],

  auditLogs: [
    {
      id: "audit-0",
      timestamp: "2026-05-26T18:00:00Z",
      userId: "sys-01",
      userName: "System Engine",
      action: "Vinea Initialized",
      details: "Bootstrap primary database entities: 5 tanks, 4 active lots, active spontaneous fermentation logs, and lab analysis curves.",
      relatedType: "winery"
    }
  ]
};
export type MockDataType = typeof mockData;
