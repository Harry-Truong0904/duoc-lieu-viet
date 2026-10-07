#!/usr/bin/env node

const fs = require("fs");
const path = require("path");

const projectRoot = path.join(__dirname, "..");
const errors = [];
const warnings = [];

const studyTypes = {
  vi: new Set(["in vitro", "động vật", "lâm sàng", "Tổng quan", "Tổng quan hệ thống (loài P. incarnata)", "Phân tích gộp"]),
  en: new Set(["in vitro", "animal", "clinical", "review", "systematic review (P. incarnata)", "meta-analysis"]),
};

function location(type, index) {
  return `${type} #${index}`;
}

function addError(message, where) {
  errors.push(`ERROR: ${where ? `${where}: ${message}` : message}`);
}

function addWarning(message, where) {
  warnings.push(`WARNING: ${where ? `${where}: ${message}` : message}`);
}

function ensureNonEmpty(value, label, where) {
  if (value === undefined || value === null || String(value).trim() === "") {
    addError(`${label} is required`, where);
  }
}

function readJson(relativePath) {
  const filePath = path.join(projectRoot, relativePath);
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch (error) {
    addError(`Could not read valid JSON (${error.message})`, relativePath);
    return null;
  }
}

function recordLocation(file, type, record, index) {
  const identity = record && record.id ? `[${record.id}]` : `#${index + 1}`;
  return `${file} ${type}${identity}`;
}

function sameKeys(left, right, where) {
  const leftKeys = Object.keys(left || {}).sort();
  const rightKeys = Object.keys(right || {}).sort();
  if (JSON.stringify(leftKeys) !== JSON.stringify(rightKeys)) {
    addError("Record structure differs between languages", where);
  }
}

function sameValue(left, right, field, where) {
  if (JSON.stringify(left) !== JSON.stringify(right)) {
    addError(`Language-neutral field "${field}" differs`, where);
  }
}

function validateData(data, language, file) {
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    addError("Dataset must be a JSON object", file);
    return null;
  }

  const collections = {};
  for (const collection of ["effects", "compounds", "plants"]) {
    if (!Array.isArray(data[collection])) {
      addError(`${collection} must be an array`, file);
      collections[collection] = [];
    } else {
      collections[collection] = data[collection];
    }
  }

  const ids = { effects: new Set(), compounds: new Set(), plants: new Set() };
  for (const collection of ["effects", "compounds", "plants"]) {
    for (const [index, record] of collections[collection].entries()) {
      const where = recordLocation(file, collection, record, index);
      if (!record || typeof record !== "object" || Array.isArray(record)) {
        addError("Record must be an object", where);
        continue;
      }

      ensureNonEmpty(record.id, "id", where);
      if (record.id) {
        if (ids[collection].has(record.id)) addError(`Duplicate id "${record.id}"`, where);
        ids[collection].add(record.id);
      }

      if (collection === "effects") {
        ensureNonEmpty(record.name, "name", where);
        ensureNonEmpty(record.description, "description", where);
      } else if (collection === "compounds") {
        ensureNonEmpty(record.name, "name", where);
        ensureNonEmpty(record.cls, "cls", where);
        ensureNonEmpty(record.mech, "mech", where);
      } else {
        for (const field of ["name", "alt", "sci", "family", "parts", "origin", "trad", "art", "safety"]) {
          ensureNonEmpty(record[field], field, where);
        }
      }
    }
  }

  const referencedEffects = new Set();
  const referencedCompounds = new Set();
  for (const [plantIndex, plant] of collections.plants.entries()) {
    if (!plant || typeof plant !== "object" || Array.isArray(plant)) continue;
    const where = recordLocation(file, "plants", plant, plantIndex);

    for (const [field, validIds, usedIds] of [
      ["effects", ids.effects, referencedEffects],
      ["compounds", ids.compounds, referencedCompounds],
    ]) {
      if (!Array.isArray(plant[field])) {
        addError(`${field} must be an array`, where);
        continue;
      }
      for (const id of plant[field]) {
        if (!validIds.has(id)) addError(`References missing ${field.slice(0, -1)} id "${id}"`, where);
        usedIds.add(id);
      }
    }

    if (!Array.isArray(plant.studies)) {
      addError("studies must be an array", where);
      continue;
    }
    for (const [studyIndex, study] of plant.studies.entries()) {
      const studyWhere = `${where} studies[#${studyIndex + 1}]`;
      if (!study || typeof study !== "object" || Array.isArray(study)) {
        addError("Study must be an object", studyWhere);
        continue;
      }
      if (!study.type || String(study.type).trim() === "") {
        addWarning("Study is missing a type", studyWhere);
      } else if (!studyTypes[language].has(study.type)) {
        addWarning(`Study type "${study.type}" is not in the allowed ${language} set`, studyWhere);
      }
    }
  }

  for (const [index, effect] of collections.effects.entries()) {
    if (effect && !referencedEffects.has(effect.id)) {
      addWarning(`Effect "${effect.id}" is not used by any plant`, recordLocation(file, "effects", effect, index));
    }
  }
  for (const [index, compound] of collections.compounds.entries()) {
    if (compound && !referencedCompounds.has(compound.id)) {
      addWarning(`Compound "${compound.id}" is not used by any plant`, recordLocation(file, "compounds", compound, index));
    }
  }

  return { data, collections, ids };
}

function compareCollections(vietnamese, english, collection, neutralFields, translatedFields) {
  const viRecords = vietnamese.collections[collection];
  const enRecords = english.collections[collection];
  const viById = new Map(viRecords.filter(record => record && record.id).map(record => [record.id, record]));
  const enById = new Map(enRecords.filter(record => record && record.id).map(record => [record.id, record]));

  for (const id of new Set([...viById.keys(), ...enById.keys()])) {
    const viRecord = viById.get(id);
    const enRecord = enById.get(id);
    const where = `${collection}[${id}]`;
    if (!viRecord || !enRecord) {
      addError(`Id "${id}" is present in only one language file`, where);
      continue;
    }

    sameKeys(viRecord, enRecord, where);
    for (const field of neutralFields) sameValue(viRecord[field], enRecord[field], field, where);
    for (const field of translatedFields) {
      ensureNonEmpty(viRecord[field], field, `data/vi.json ${where}`);
      ensureNonEmpty(enRecord[field], field, `data/en.json ${where}`);
    }
  }
}

const vietnameseData = readJson("data/vi.json");
const englishData = readJson("data/en.json");
const vietnameseUi = readJson("i18n/vi.json");
const englishUi = readJson("i18n/en.json");
const validatedVietnamese = validateData(vietnameseData, "vi", "data/vi.json");
const validatedEnglish = validateData(englishData, "en", "data/en.json");

if (vietnameseData && englishData) {
  sameKeys(vietnameseData, englishData, "data/vi.json and data/en.json");
}

if (validatedVietnamese && validatedEnglish) {
  for (const collection of ["effects", "compounds", "plants"]) {
    compareCollections(
      validatedVietnamese,
      validatedEnglish,
      collection,
      collection === "plants" ? ["sci", "alt", "effects", "compounds"] : collection === "compounds" ? ["name"] : [],
      collection === "plants"
        ? ["name", "alt", "family", "parts", "origin", "trad", "art", "safety"]
        : collection === "compounds"
          ? ["cls", "mech"]
          : ["name", "description"]
    );
  }

  for (const [plantIndex, viPlant] of validatedVietnamese.collections.plants.entries()) {
    if (!viPlant || !viPlant.id) continue;
    const enPlant = validatedEnglish.collections.plants.find(plant => plant && plant.id === viPlant.id);
    if (!enPlant || !Array.isArray(viPlant.studies) || !Array.isArray(enPlant.studies)) continue;
    const where = `plants[${viPlant.id}] studies`;
    if (viPlant.studies.length !== enPlant.studies.length) {
      addError("Study count differs between languages", where);
      continue;
    }
    viPlant.studies.forEach((viStudy, index) => {
      const enStudy = enPlant.studies[index];
      const studyWhere = `${where}[#${index + 1}]`;
      if (!viStudy || !enStudy) return;
      sameKeys(viStudy, enStudy, studyWhere);
      for (const field of ["t", "a", "y", "j", "verification"]) {
        sameValue(viStudy[field], enStudy[field], field, studyWhere);
      }
    });
  }
}

if (vietnameseUi && englishUi) {
  const viKeys = Object.keys(vietnameseUi).sort();
  const enKeys = Object.keys(englishUi).sort();
  if (JSON.stringify(viKeys) !== JSON.stringify(enKeys)) {
    addError("UI dictionary keys do not match", "i18n/vi.json and i18n/en.json");
  }
  for (const key of new Set([...viKeys, ...enKeys])) {
    ensureNonEmpty(vietnameseUi[key], key, "i18n/vi.json");
    ensureNonEmpty(englishUi[key], key, "i18n/en.json");
  }
}

for (const issue of errors) console.error(issue);
for (const issue of warnings) console.warn(issue);

if (errors.length > 0) {
  console.error(`Validation failed: ${errors.length} error(s), ${warnings.length} warning(s).`);
  process.exitCode = 1;
} else {
  console.log(`Validation complete: ${errors.length} error(s), ${warnings.length} warning(s).`);
}
