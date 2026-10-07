let DATA_BY_LANGUAGE;
let UI_BY_LANGUAGE;
let DATA;
let UI;
let effectsById;
let compoundsById;
let currentLanguage;
let filterLogic = "all";
let sortOrder = "default";
const $ = id => document.getElementById(id);
const normalize = text => text.normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/đ/gi, "d").toLowerCase();
const message = (key, values = {}) => UI[key].replace(/\{(\w+)\}/g, (_, name) => values[name] ?? "");
const element = (tag, className, text) => {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
};
const activeEffects = new Set();

function resolveLanguage() {
  const requested = new URLSearchParams(location.search).get("lang");
  if (requested === "vi" || requested === "en") return requested;

  try {
    const saved = localStorage.getItem("language");
    if (saved === "vi" || saved === "en") return saved;
  } catch (error) {
    // Storage may be unavailable in restricted browser contexts.
  }

  return navigator.language?.toLowerCase().startsWith("en") ? "en" : "vi";
}

function applyTranslations() {
  document.title = UI.pageTitle;
  document.querySelectorAll("[data-i18n]").forEach(node => {
    node.textContent = message(node.dataset.i18n);
  });
  document.querySelectorAll("[data-i18n-placeholder]").forEach(node => {
    node.placeholder = message(node.dataset.i18nPlaceholder);
  });
  document.querySelectorAll("[data-i18n-aria-label]").forEach(node => {
    node.setAttribute("aria-label", message(node.dataset.i18nAriaLabel));
  });
  document.documentElement.lang = currentLanguage;
  const languageName = UI[currentLanguage === "vi" ? "languageNameVi" : "languageNameEn"];
  $("language-toggle").setAttribute("aria-label", message("languageToggleLabel", { language: languageName }));
  $("language-toggle").setAttribute("aria-pressed", currentLanguage === "en");
  $("language-vi").classList.toggle("is-current", currentLanguage === "vi");
  $("language-en").classList.toggle("is-current", currentLanguage === "en");
}

function plantText(plant) {
  const vietnamesePlant = DATA_BY_LANGUAGE.vi.plants.find(item => item.id === plant.id);
  const englishPlant = DATA_BY_LANGUAGE.en.plants.find(item => item.id === plant.id);
  return normalize([
    plant.name,
    vietnamesePlant.name,
    englishPlant.name,
    plant.sci,
    plant.alt,
    ...plant.compounds.map(id => compoundsById[id].name)
  ].join(" "));
}

function sortPlants(plants) {
  if (sortOrder !== "name-az") return plants;
  return [...plants].sort((left, right) => left.name.localeCompare(right.name, currentLanguage));
}

function syncListStateToUrl() {
  const url = new URL(location.href);
  const query = $("q").value.trim();
  if (query) url.searchParams.set("q", query);
  else url.searchParams.delete("q");

  if (activeEffects.size) url.searchParams.set("effects", [...activeEffects].join(","));
  else url.searchParams.delete("effects");
  if (filterLogic === "any") url.searchParams.set("logic", "any");
  else url.searchParams.delete("logic");
  if (sortOrder === "name-az") url.searchParams.set("sort", "name-az");
  else url.searchParams.delete("sort");
  history.replaceState(null, "", url);
}

function restoreListStateFromUrl() {
  const params = new URLSearchParams(location.search);
  $("q").value = params.get("q") || "";
  activeEffects.clear();
  const validEffectIds = new Set(DATA.effects.map(effect => effect.id));
  (params.get("effects") || "").split(",").filter(Boolean).forEach(id => {
    if (validEffectIds.has(id)) activeEffects.add(id);
  });
  filterLogic = params.get("logic") === "any" ? "any" : "all";
  sortOrder = params.get("sort") === "name-az" ? "name-az" : "default";
  $("logic-all").setAttribute("aria-pressed", filterLogic === "all");
  $("logic-any").setAttribute("aria-pressed", filterLogic === "any");
  $("sort-select").value = sortOrder;
}

function effectLink(effectId) {
  const effectName = effectsById[effectId];
  const link = element("a", "tag", effectName);
  link.href = "#effect/" + encodeURIComponent(effectId);
  link.setAttribute("aria-label", message("showAllPlantsForEffect", { effect: effectName }));
  return link;
}

function plantCard(plant) {
  const card = element("article", "card");
  const plantLink = element("a", "card-link");
  plantLink.href = "#" + encodeURIComponent(plant.id);
  plantLink.append(element("h3", null, plant.name), element("div", "sci", plant.sci));
  const tags = element("div", "tags");
  plant.effects.forEach(id => tags.append(effectLink(id)));
  card.append(plantLink, tags);
  return card;
}

function render() {
  const query = normalize($("q").value.trim());
  const results = sortPlants(DATA.plants.filter(plant => {
    const matchesQuery = !query || plantText(plant).includes(query);
    const matchesEffects = !activeEffects.size || (filterLogic === "all"
      ? [...activeEffects].every(id => plant.effects.includes(id))
      : [...activeEffects].some(id => plant.effects.includes(id)));
    return matchesQuery && matchesEffects;
  }));

  $("count").textContent = message("count", { shown: results.length, total: DATA.plants.length });
  const grid = $("grid");
  grid.replaceChildren();
  if (!results.length) {
    grid.append(element("p", "empty", message("noPlantsMatch")));
    return;
  }

  results.forEach(plant => grid.append(plantCard(plant)));
}

function renderEffect(effectId) {
  const detail = $("detail");
  detail.replaceChildren();
  const back = element("a", "back", message("effectBackToAllPlants"));
  back.href = "#";
  detail.append(back);

  const effect = DATA.effects.find(item => item.id === effectId);
  if (!effect) {
    detail.append(element("p", "empty", message("effectNotFound")));
    return;
  }

  detail.append(element("h1", null, effect.name), element("p", "effect-description", effect.description));
  const effectPlants = DATA.plants.filter(plant => plant.effects.includes(effectId));
  const query = normalize($("q").value.trim());
  const results = sortPlants(effectPlants.filter(plant => !query || plantText(plant).includes(query)));
  detail.append(
    element("h2", null, message("effectPlantsHeading")),
    element("p", "count", message("count", { shown: results.length, total: effectPlants.length }))
  );

  const grid = element("div", "grid");
  if (!results.length) {
    grid.append(element("p", "empty", effectPlants.length ? message("noPlantsMatch") : message("effectEmpty")));
  } else {
    results.forEach(plant => grid.append(plantCard(plant)));
  }
  detail.append(grid, element("h2", null, message("effectCompoundsHeading")));

  const compoundIds = new Set(results.flatMap(plant => plant.compounds));
  const compoundLinks = element("div", "compound-links");
  compoundIds.forEach(id => {
    const link = element("a", "compound-link", compoundsById[id].name);
    link.href = "#compound/" + encodeURIComponent(id);
    compoundLinks.append(link);
  });
  detail.append(compoundLinks);
}

function renderCompound(compoundId) {
  const detail = $("detail");
  detail.replaceChildren();
  const back = element("a", "back", message("compoundBackToAllPlants"));
  back.href = "#";
  detail.append(back);

  const compound = DATA.compounds.find(item => item.id === compoundId);
  if (!compound) {
    detail.append(element("p", "empty", message("compoundNotFound")));
    return;
  }

  const metadata = element("dl", "meta");
  metadata.append(
    element("dt", null, message("compoundClassLabel")),
    element("dd", null, compound.cls),
    element("dt", null, message("compoundMechanismLabel")),
    element("dd", null, compound.mech)
  );
  detail.append(element("h1", null, compound.name), metadata, element("h2", null, message("compoundPlantsHeading")));

  const plants = sortPlants(DATA.plants.filter(plant => plant.compounds.includes(compoundId)));
  const grid = element("div", "grid");
  if (!plants.length) {
    grid.append(element("p", "empty", message("compoundEmpty")));
  } else {
    plants.forEach(plant => grid.append(plantCard(plant)));
  }
  detail.append(grid);
}

function show() {
  const route = location.hash.slice(1);
  const searchControl = $("search-control");
  if (route.startsWith("effect/")) {
    const effectId = decodeURIComponent(route.slice("effect/".length));
    $("lede").hidden = true;
    searchControl.hidden = false;
    $("list").hidden = true;
    $("detail").hidden = false;
    renderEffect(effectId);
    window.scrollTo(0, 0);
    return;
  }
  if (route.startsWith("compound/")) {
    const compoundId = decodeURIComponent(route.slice("compound/".length));
    $("lede").hidden = true;
    searchControl.hidden = true;
    $("list").hidden = true;
    $("detail").hidden = false;
    renderCompound(compoundId);
    window.scrollTo(0, 0);
    return;
  }

  const plantId = route.startsWith("plant/") ? decodeURIComponent(route.slice(6)) : route;
  const plant = DATA.plants.find(item => item.id === plantId);
  const detail = $("detail");
  $("lede").hidden = !!plant;
  searchControl.hidden = !!plant;
  $("list").hidden = !!plant;
  detail.hidden = !plant;
  if (!plant) {
    render();
    return;
  }

  detail.replaceChildren();
  const back = element("button", "back", message("backToAllPlants"));
  back.onclick = () => { location.hash = ""; };
  const metadata = element("dl", "meta");
  [[message("labelFamily"), plant.family], [message("labelParts"), plant.parts], [message("labelOrigin"), plant.origin], [message("labelTraditionalUse"), plant.trad], [message("labelOtherNames"), plant.alt]]
    .forEach(([label, value]) => metadata.append(element("dt", null, label), element("dd", null, value)));
  const tags = element("div", "tags");
  plant.effects.forEach(id => tags.append(effectLink(id)));
  detail.append(back, element("h1", null, plant.name), element("div", "sci", plant.sci), tags, metadata,
    element("h2", null, message("summaryHeading")), element("p", null, plant.art), element("h2", null, message("compoundsHeading")));

  plant.compounds.forEach(id => {
    const compound = compoundsById[id];
    const item = element("a", "cmp compound-detail-link");
    item.href = "#compound/" + encodeURIComponent(id);
    item.append(element("b", null, compound.name), element("small", null, compound.cls), element("span", null, compound.mech));
    detail.append(item);
  });

  detail.append(element("h2", null, message("studiesHeading")));
  if (!plant.studies.length) {
    detail.append(element("p", "empty", message("noStudies")));
  }
  plant.studies.forEach(study => {
    const verification = study.verification === "unverified" ? message("studyUnverified") : "";
    detail.append(element("p", "study", message("studyCitation", {
      author: study.a,
      year: study.y,
      title: study.t,
      journal: study.j,
      type: study.type,
      verification
    })));
  });
  detail.append(element("h2", null, message("safetyHeading")), element("p", "warn", plant.safety));
  window.scrollTo(0, 0);
}

function showLoadError() {
  $("list").hidden = true;
  $("detail").hidden = true;
  $("load-error").hidden = false;
}

async function start() {
  currentLanguage = resolveLanguage();
  try {
    const viUiResponse = await fetch("i18n/vi.json");
    if (!viUiResponse.ok) throw new Error("Vietnamese UI dictionary request failed: " + viUiResponse.status);
    UI_BY_LANGUAGE = { vi: await viUiResponse.json() };
    UI = UI_BY_LANGUAGE.vi;
    applyTranslations();

    const enUiResponse = await fetch("i18n/en.json");
    if (!enUiResponse.ok) throw new Error("English UI dictionary request failed: " + enUiResponse.status);
    UI_BY_LANGUAGE.en = await enUiResponse.json();

    const [viDataResponse, enDataResponse] = await Promise.all([
      fetch("data/vi.json"),
      fetch("data/en.json")
    ]);
    if (!viDataResponse.ok || !enDataResponse.ok) throw new Error("Language data request failed");
    DATA_BY_LANGUAGE = {
      vi: await viDataResponse.json(),
      en: await enDataResponse.json()
    };
    DATA = DATA_BY_LANGUAGE[currentLanguage];
    UI = UI_BY_LANGUAGE[currentLanguage];
    applyTranslations();
  } catch (error) {
    if (!UI) return;
    showLoadError();
    return;
  }

  effectsById = Object.fromEntries(DATA.effects.map(effect => [effect.id, effect.name]));
  compoundsById = Object.fromEntries(DATA.compounds.map(compound => [compound.id, compound]));
  DATA.effects.forEach(effect => {
    const button = element("button", "chip", effect.name);
    button.setAttribute("aria-pressed", activeEffects.has(effect.id));
    button.onclick = () => {
      activeEffects.has(effect.id) ? activeEffects.delete(effect.id) : activeEffects.add(effect.id);
      button.setAttribute("aria-pressed", activeEffects.has(effect.id));
      syncListStateToUrl();
      render();
    };
    $("chips").append(button);
  });
  restoreListStateFromUrl();
  DATA.effects.forEach((effect, index) => {
    $("chips").children[index].setAttribute("aria-pressed", activeEffects.has(effect.id));
  });
  $("q").oninput = () => {
    syncListStateToUrl();
    const route = location.hash.slice(1);
    if (route.startsWith("effect/")) renderEffect(decodeURIComponent(route.slice("effect/".length)));
    else render();
  };
  const updateFilterLogic = logic => {
    filterLogic = logic;
    $("logic-all").setAttribute("aria-pressed", filterLogic === "all");
    $("logic-any").setAttribute("aria-pressed", filterLogic === "any");
    syncListStateToUrl();
    render();
  };
  $("logic-all").onclick = () => updateFilterLogic("all");
  $("logic-any").onclick = () => updateFilterLogic("any");
  $("sort-select").onchange = event => {
    sortOrder = event.target.value;
    syncListStateToUrl();
    const route = location.hash.slice(1);
    if (route.startsWith("effect/")) renderEffect(decodeURIComponent(route.slice("effect/".length)));
    else render();
  };
  $("language-toggle").onclick = () => {
    currentLanguage = currentLanguage === "vi" ? "en" : "vi";
    DATA = DATA_BY_LANGUAGE[currentLanguage];
    UI = UI_BY_LANGUAGE[currentLanguage];
    try {
      localStorage.setItem("language", currentLanguage);
    } catch (error) {
      // The URL still records the language if storage is unavailable.
    }
    const url = new URL(location.href);
    url.searchParams.set("lang", currentLanguage);
    history.replaceState(null, "", url);
    applyTranslations();
    effectsById = Object.fromEntries(DATA.effects.map(effect => [effect.id, effect.name]));
    compoundsById = Object.fromEntries(DATA.compounds.map(compound => [compound.id, compound]));
    $("chips").replaceChildren();
    DATA.effects.forEach(effect => {
      const button = element("button", "chip", effect.name);
      button.setAttribute("aria-pressed", activeEffects.has(effect.id));
      button.onclick = () => {
        activeEffects.has(effect.id) ? activeEffects.delete(effect.id) : activeEffects.add(effect.id);
        button.setAttribute("aria-pressed", activeEffects.has(effect.id));
        syncListStateToUrl();
        render();
      };
      $("chips").append(button);
    });
    show();
  };
  window.onhashchange = show;
  show();
}

start();