
const API_BASE = 'http://localhost:8000/api/v1';

const jsonHeaders = { Accept: 'application/json' };

/**
 * Noms de genres tels que renvoyés par l’API (IMDb) → libellé affiché en français.
 * Les genres absents de la table gardent leur nom anglais.
 */
const GENRE_LABEL_FR = {
  Action: "Films d'action",
  Adventure: 'Aventure',
  Animation: 'Animation',
  Biography: 'Biographie',
  Comedy: 'Comédies',
  Crime: 'Crime',
  Documentary: 'Documentaire',
  Drama: 'Drame',
  Family: 'Famille',
  Fantasy: 'Films de fantasy',
  'Film-Noir': 'Film noir',
  History: 'Histoire',
  Horror: "Films d'horreur",
  Music: 'Musique',
  Musical: 'Comédie musicale',
  Mystery: 'Mystery',
  Romance: 'Romance',
  'Sci-Fi': 'Science-fiction',
  Short: 'Court métrage',
  Sport: 'Sport',
  Thriller: 'Thriller',
  War: 'Guerre',
  Western: 'Westerns',
};

function genreLabelFr(apiName) {
  return GENRE_LABEL_FR[apiName] || apiName;
}

// ——— Constantes de grilles (requêtes /titles/?genre=… ou tri par note) ———

/** Catégorie 1 : section « Mystery » (titre fixe dans le HTML). */
const CATEGORY1_API_GENRE = 'Mystery';

/** Catégorie 2 : section « Famille » (titre fixe dans le HTML). */
const CATEGORY2_API_GENRE = 'Family';

const CATEGORY_GRID_PAGE_SIZE = 6;

/** Liste triée par note : on en demande 7 pour afficher les 6 films après le #1 (réservé au bloc « Meilleur film »). */
const TOP_RATED_LIST_PAGE_SIZE = 7;

/** Objet détail du film « vedette » (après GET /titles/:id), réutilisé pour la modale. */
let bestFilmDetail = null;

// ——— Utilitaires sécurité / affichage ———

/** Échappe les caractères HTML pour les chaînes injectées en innerHTML (ex. métadonnées modale). */
function esc(s) {
  if (s == null || s === '') return '';
  const el = document.createElement('div');
  el.textContent = String(s);
  return el.innerHTML;
}

function clearPosterFallback(container) {
  if (!container) return;
  container.querySelectorAll('.poster-fallback').forEach((el) => el.remove());
}

function createPosterFallbackNode() {
  const fb = document.createElement('div');
  fb.className = 'poster-fallback';
  fb.setAttribute('role', 'img');
  fb.setAttribute(
    'aria-label',
    "Affiche indisponible : l'illustration n'a pas pu être chargée."
  );
  fb.textContent =
    "Affiche indisponible.\nL'image n'a pas pu être chargée (lien invalide ou fichier retiré).";
  return fb;
}

/**
 * Affiche l’affiche ou un message de repli si URL vide / erreur réseau / 404.
 * @param {HTMLImageElement} img
 * @param {HTMLElement} container — parent positionné (.film-card__media, .best-film__media, .modal__poster-wrap)
 */
function applyPosterImage(img, container, url, titleAlt) {
  clearPosterFallback(container);
  img.onload = null;
  img.onerror = null;
  img.alt = titleAlt || '';

  if (!url) {
    img.removeAttribute('src');
    img.style.display = 'none';
    container.appendChild(createPosterFallbackNode());
    return;
  }

  img.style.display = '';
  img.onload = () => {
    clearPosterFallback(container);
    img.style.display = '';
  };
  img.onerror = () => {
    img.style.display = 'none';
    clearPosterFallback(container);
    container.appendChild(createPosterFallbackNode());
  };
  img.src = url;
}

function formatMoney(n) {
  if (n == null) return '';
  return new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(n);
}

/** Construit le bloc HTML (lignes séparées par <br>) des infos modale : année, genres, durée, note, etc. */
function buildMetaLines(m) {
  const genres = (m.genres || []).join(', ') || '—';
  const countries = (m.countries || []).join(', ') || '';
  const rated = m.rated || '—';
  const duration = m.duration != null ? `${m.duration} min` : '—';
  const loc = countries ? ` (${countries})` : '';
  const lines = [
    `${m.year} — ${genres}`,
    `${rated} · ${duration}${loc}`,
    `IMDB : ${m.imdb_score}/10 · ${(m.votes != null ? m.votes : '—')} votes`,
  ];
  if (m.usa_gross_income != null) {
    lines.push(`Recettes USA : ${formatMoney(m.usa_gross_income)}`);
  }
  return lines.map((line) => esc(line)).join('<br>');
}

/** Remplit la modale à partir d’un objet détail API (même schéma que GET /titles/:id). */
function fillModalFromDetail(m) {
  const poster = document.querySelector('.modal__poster');
  const wrap = document.querySelector('.modal__poster-wrap');
  applyPosterImage(
    poster,
    wrap,
    m.image_url || '',
    m.title ? `Affiche du film ${m.title}` : ''
  );

  document.getElementById('modal-film-title').textContent = m.title || '';
  document.querySelector('.modal__meta').innerHTML = buildMetaLines(m);

  const dirs = (m.directors || []).join(', ') || '—';
  document.querySelector('.modal__director-name').textContent = dirs;

  const synopsis = m.long_description || m.description || '';
  document.querySelector('.modal__description').textContent = synopsis;

  const cast = (m.actors || []).join(', ') || '—';
  document.querySelector('.modal__cast').textContent = cast;
}

/** Met à jour le bloc « Meilleur film » (affiche + titre + description courte) après chargement API. */
function populateBestFilm(m) {
  const poster = document.getElementById('best-film-poster');
  const wrap = poster.closest('.best-film__media');
  applyPosterImage(
    poster,
    wrap,
    m.image_url || '',
    m.title ? `Affiche du film ${m.title}` : ''
  );

  document.getElementById('best-film-title').textContent = m.title || '—';

  const shortDesc = m.description || m.long_description || '';
  document.getElementById('best-film-description').textContent = shortDesc;

  document.getElementById('best-film-details-btn').disabled = false;
}

/** Retourne le film #1 par note IMDB (tri côté serveur, une seule page). */
async function fetchTopRatedSummary() {
  const listUrl = `${API_BASE}/titles/?sort_by=-imdb_score&page_size=1`;

  const res = await fetch(listUrl, { headers: jsonHeaders });
  if (!res.ok) {
    console.error('[Meilleur film] Erreur HTTP liste', res.status, res.statusText);
    throw new Error('liste');
  }
  const data = await res.json();
  const first = data.results && data.results[0];
  return first || null;
}

/**
 * Charge le meilleur film : liste triée → id → GET détail pour affiche + texte + bestFilmDetail.
 */
async function loadBestFilm() {
  const titleEl = document.getElementById('best-film-title');
  const descEl = document.getElementById('best-film-description');
  const btn = document.getElementById('best-film-details-btn');


  titleEl.textContent = 'Chargement…';
  descEl.textContent = '';
  btn.disabled = true;
  bestFilmDetail = null;

  try {
    const bestSummary = await fetchTopRatedSummary();
    if (!bestSummary) {
      console.warn('[Meilleur film] Liste vide.');
      throw new Error('vide');
    }

    const detailUrl = `${API_BASE}/titles/${bestSummary.id}`;

    const detailRes = await fetch(detailUrl, { headers: jsonHeaders });
    if (!detailRes.ok) {
      console.error('[Meilleur film] Erreur HTTP détail', detailRes.status, detailRes.statusText);
      throw new Error('détail');
    }

    bestFilmDetail = await detailRes.json();
    populateBestFilm(bestFilmDetail);
  } catch (err) {
    console.error('[Meilleur film] Échec :', err);
    titleEl.textContent = 'Meilleur film';
    descEl.textContent =
      'Impossible de charger les données. Vérifiez que l’API tourne sur http://localhost:8000 et réessayez.';
  }
}

function openBestFilmModal() {
  if (!bestFilmDetail) return;
  fillModalFromDetail(bestFilmDetail);
  document.getElementById('modal-overlay').classList.add('open');
  document.body.style.overflow = 'hidden';
}

function closeModal() {
  document.getElementById('modal-overlay').classList.remove('open');
  document.body.style.overflow = '';
}

/**
 * Construit une carte film pour les grilles (API) : clic / Entrée / Espace ouvre le détail.
 */
function createFilmCardElement(m) {
  const card = document.createElement('div');
  card.className = 'film-card';
  card.tabIndex = 0;
  card.setAttribute('aria-label', m.title || 'Film');

  const openDetails = () => openFilmDetailModal(m.id);

  card.addEventListener('click', openDetails);
  card.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      openDetails();
    }
  });

  const media = document.createElement('div');
  media.className = 'film-card__media';

  const img = document.createElement('img');
  img.loading = 'lazy';

  const ribbon = document.createElement('div');
  ribbon.className = 'film-card__ribbon';

  const titleP = document.createElement('p');
  titleP.className = 'film-card__title';
  titleP.textContent = m.title || '—';

  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'film-card__btn-details';
  btn.textContent = 'Détails';
  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    openDetails();
  });

  ribbon.append(titleP, btn);
  media.append(img, ribbon);
  applyPosterImage(
    img,
    media,
    m.image_url || '',
    m.title ? `Affiche ${m.title}` : ''
  );
  card.append(media);
  return card;
}

/** Fetch le détail d’un film par id puis ouvre la modale (grilles générées en JS). */
async function openFilmDetailModal(movieId) {
  try {
    const res = await fetch(`${API_BASE}/titles/${movieId}`, { headers: jsonHeaders });
    if (!res.ok) throw new Error('détail');
    const detail = await res.json();
    fillModalFromDetail(detail);
    document.getElementById('modal-overlay').classList.add('open');
    document.body.style.overflow = 'hidden';
  } catch (err) {
    console.error('[Détail film]', movieId, err);
  }
}

/** Cartes statiques du HTML : ouverture modale via `data-film-id` (identifiants API OCMovies). */
function initStaticFilmCardModals() {
  const main = document.querySelector('main');
  if (!main) return;

  main.addEventListener('click', (e) => {
    const card = e.target.closest('.film-card[data-film-id]');
    if (!card) return;
    const raw = card.dataset.filmId;
    const id = raw != null && raw !== '' ? Number(raw) : NaN;
    if (!Number.isFinite(id)) return;
    openFilmDetailModal(id);
  });

  main.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    const card = e.target.closest('.film-card[data-film-id]');
    if (!card) return;
    e.preventDefault();
    const raw = card.dataset.filmId;
    const id = raw != null && raw !== '' ? Number(raw) : NaN;
    if (!Number.isFinite(id)) return;
    openFilmDetailModal(id);
  });
}

/**
 * Récupère tous les genres (pagination par `next` jusqu’à la fin de liste).
 */
async function fetchAllGenres() {
  const genres = [];
  let url = `${API_BASE}/genres/?page_size=50`;

  while (url) {
    const res = await fetch(url, { headers: jsonHeaders });
    if (!res.ok) throw new Error('genres');
    const data = await res.json();
    if (data.results && data.results.length) {
      genres.push(...data.results);
    }
    url = data.next || null;
  }

  return genres;
}

/** Remplit le menu déroulant avec les genres de l’API (value = nom exact pour ?genre=). */
async function loadGenreSelect(selectEl) {
  selectEl.disabled = true;
  selectEl.replaceChildren();
  const loadingOpt = document.createElement('option');
  loadingOpt.value = '';
  loadingOpt.textContent = 'Chargement des genres…';
  loadingOpt.disabled = true;
  selectEl.appendChild(loadingOpt);

  try {
    const genres = await fetchAllGenres();
    selectEl.replaceChildren();

    if (genres.length === 0) {
      const opt = document.createElement('option');
      opt.value = '';
      opt.textContent = 'Aucun genre';
      selectEl.appendChild(opt);
      selectEl.disabled = false;
      return;
    }

    genres.forEach((g) => {
      const opt = document.createElement('option');
      opt.value = g.name;
      opt.textContent = genreLabelFr(g.name);
      selectEl.appendChild(opt);
    });

    selectEl.disabled = false;

    const comedyIdx = genres.findIndex((x) => x.name === 'Comedy');
    selectEl.selectedIndex = comedyIdx >= 0 ? comedyIdx : 0;
  } catch (err) {
    console.error('[Genres]', err);
    selectEl.replaceChildren();
    const errOpt = document.createElement('option');
    errOpt.value = '';
    errOpt.textContent = 'Genres indisponibles';
    selectEl.appendChild(errOpt);
    selectEl.disabled = false;
  }
}

/**
 * Overlay « Chargement… » sur la grille dynamique (shell #dynamic-grid-shell) pour éviter un saut de hauteur.
 */
function setCategoryShellLoading(gridEl, active) {
  const shell = gridEl.closest('.category-grid-shell');
  if (!shell) return;
  shell.classList.toggle('is-loading', active);
  const existing = shell.querySelector('.category-grid__loading-layer');
  if (active) {
    if (existing) return;
    const layer = document.createElement('div');
    layer.className = 'category-grid__loading-layer';
    layer.setAttribute('aria-hidden', 'true');
    const span = document.createElement('span');
    span.className = 'category-grid__loading-text';
    span.textContent = 'Chargement…';
    layer.appendChild(span);
    shell.appendChild(layer);
  } else if (existing) {
    existing.remove();
  }
}

/** Associe chaque grille .films-grid--category à son bouton « Voir plus » dans le HTML. */
function getCategoryExpandButton(gridEl) {
  if (gridEl.id === 'top-rated-grid') return document.getElementById('top-rated-expand-btn');
  if (gridEl.id === 'mystery-grid') return document.getElementById('mystery-expand-btn');
  if (gridEl.id === 'cat2-grid') return document.getElementById('cat2-expand-btn');
  if (gridEl.id === 'dynamic-grid') return document.getElementById('dynamic-expand-btn');
  return null;
}

/** Synchronise le bouton Voir plus / moins (masqué si aucune carte film). */
function updateCategoryExpandButton(gridEl) {
  const btn = getCategoryExpandButton(gridEl);
  if (!btn || !gridEl.classList.contains('films-grid--category')) return;
  const hasCards = !!gridEl.querySelector('.film-card');
  btn.classList.toggle('btn-category-expand--inactive', !hasCards);
  const expanded = gridEl.classList.contains('films-grid--expanded');
  btn.textContent = expanded ? 'Voir moins' : 'Voir plus';
  btn.setAttribute('aria-expanded', expanded ? 'true' : 'false');
}

/** Branche chaque paire bouton / grille pour basculer .films-grid--expanded au clic. */
function wireCategoryExpandButtons() {
  const pairs = [
    ['top-rated-expand-btn', 'top-rated-grid'],
    ['mystery-expand-btn', 'mystery-grid'],
    ['cat2-expand-btn', 'cat2-grid'],
    ['dynamic-expand-btn', 'dynamic-grid'],
  ];
  pairs.forEach(([btnId, gridId]) => {
    const btn = document.getElementById(btnId);
    const grid = document.getElementById(gridId);
    if (!btn || !grid) return;
    btn.addEventListener('click', () => {
      grid.classList.toggle('films-grid--expanded');
      updateCategoryExpandButton(grid);
    });
  });
}

/**
 * Section « Films les mieux notés » : 7 résultats triés par note, on ignore le 1er (déjà en « Meilleur film »).
 */
async function loadTopRatedGrid() {
  const gridEl = document.getElementById('top-rated-grid');
  if (!gridEl) return;

  gridEl.replaceChildren();
  const loading = document.createElement('p');
  loading.className = 'films-grid__msg';
  loading.textContent = 'Chargement…';
  gridEl.appendChild(loading);

  try {
    const params = new URLSearchParams({
      sort_by: '-imdb_score',
      page_size: String(TOP_RATED_LIST_PAGE_SIZE),
    });
    const url = `${API_BASE}/titles/?${params}`;
    const res = await fetch(url, { headers: jsonHeaders });
    if (!res.ok) throw new Error('liste');

    const data = await res.json();
    const results = data.results || [];
    gridEl.replaceChildren();

    const others = results.slice(1, 1 + CATEGORY_GRID_PAGE_SIZE);
    if (others.length === 0) {
      const empty = document.createElement('p');
      empty.className = 'films-grid__msg';
      empty.textContent =
        results.length === 0
          ? 'Aucun film disponible.'
          : 'Pas assez de films pour afficher cette section (le meilleur film occupe déjà la zone principale).';
      gridEl.appendChild(empty);
      return;
    }

    others.forEach((m) => gridEl.appendChild(createFilmCardElement(m)));
  } catch (err) {
    console.error('[Films les mieux notés]', err);
    gridEl.replaceChildren();
    const errP = document.createElement('p');
    errP.className = 'films-grid__msg';
    errP.textContent = 'Impossible de charger les films les mieux notés.';
    gridEl.appendChild(errP);
  } finally {
    if (gridEl.classList.contains('films-grid--category')) {
      gridEl.classList.remove('films-grid--expanded');
      updateCategoryExpandButton(gridEl);
    }
  }
}

/**
 * Grille catégorie (Mystery, Famille, ou genre du select) : GET /titles/?genre=&sort_by=-imdb_score&page_size=6.
 */
async function loadCategoryGrid(apiGenreName, gridEl) {
  const shell = gridEl.closest('.category-grid-shell');
  const hasFilmCards = gridEl.querySelector('.film-card');

  if (shell && hasFilmCards) {
    setCategoryShellLoading(gridEl, true);
  } else {
    gridEl.replaceChildren();
    const loading = document.createElement('p');
    loading.className = 'films-grid__msg';
    loading.textContent = 'Chargement…';
    gridEl.appendChild(loading);
  }

  try {
    const params = new URLSearchParams({
      genre: apiGenreName,
      sort_by: '-imdb_score',
      page_size: String(CATEGORY_GRID_PAGE_SIZE),
    });
    const url = `${API_BASE}/titles/?${params}`;
    const res = await fetch(url, { headers: jsonHeaders });
    if (!res.ok) throw new Error('liste');

    const data = await res.json();
    const results = data.results || [];
    gridEl.replaceChildren();

    if (results.length === 0) {
      const empty = document.createElement('p');
      empty.className = 'films-grid__msg';
      empty.textContent = 'Aucun film pour ce genre.';
      gridEl.appendChild(empty);
      return;
    }

    results.forEach((m) => gridEl.appendChild(createFilmCardElement(m)));
  } catch (err) {
    console.error('[Catégorie]', apiGenreName, err);
    gridEl.replaceChildren();
    const errP = document.createElement('p');
    errP.className = 'films-grid__msg';
    errP.textContent = 'Impossible de charger les films de cette catégorie.';
    gridEl.appendChild(errP);
  } finally {
    setCategoryShellLoading(gridEl, false);
    if (gridEl.classList.contains('films-grid--category')) {
      gridEl.classList.remove('films-grid--expanded');
      updateCategoryExpandButton(gridEl);
    }
  }
}

// ——— Initialisation au chargement de la page ———

document.addEventListener('DOMContentLoaded', () => {
  initStaticFilmCardModals();

  // Clic sur le fond (overlay) : fermer la modale sans bloquer les clics à l’intérieur
  document.getElementById('modal-overlay').addEventListener('click', function (e) {
    if (e.target === this) closeModal();
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closeModal();
  });

  const catSelect = document.getElementById('cat-select');
  const dynamicGrid = document.getElementById('dynamic-grid');
  const cat2Grid = document.getElementById('cat2-grid');
  const topRatedGrid = document.getElementById('top-rated-grid');
  const mysteryGrid = document.getElementById('mystery-grid');

  /** Quand le select « Autres » change : met à jour le titre de section et recharge la grille. */
  function reloadDynamicCategory() {
    const apiGenre = catSelect.value;
    const titleEl = document.getElementById('dynamic-title');

    if (!apiGenre) {
      titleEl.textContent = 'Catégorie';
      dynamicGrid.replaceChildren();
      const p = document.createElement('p');
      p.className = 'films-grid__msg';
      p.textContent = 'Choisissez un genre une fois la liste chargée.';
      dynamicGrid.appendChild(p);
      dynamicGrid.classList.remove('films-grid--expanded');
      updateCategoryExpandButton(dynamicGrid);
      return;
    }

    const label =
      catSelect.options[catSelect.selectedIndex]?.textContent || genreLabelFr(apiGenre);
    titleEl.textContent = label;
    loadCategoryGrid(apiGenre, dynamicGrid);
  }

  if (catSelect && dynamicGrid) {
    catSelect.addEventListener('change', reloadDynamicCategory);
  }

  document.getElementById('best-film-details-btn').addEventListener('click', openBestFilmModal);

  // « Voir plus / moins » : classe .films-grid--expanded sur la grille (styles dans le CSS)
  wireCategoryExpandButtons();
  if (topRatedGrid) updateCategoryExpandButton(topRatedGrid);
  if (mysteryGrid) updateCategoryExpandButton(mysteryGrid);
  if (cat2Grid) updateCategoryExpandButton(cat2Grid);
  if (dynamicGrid) updateCategoryExpandButton(dynamicGrid);

  loadBestFilm();
  loadTopRatedGrid();
  if (mysteryGrid) loadCategoryGrid(CATEGORY1_API_GENRE, mysteryGrid);
  if (cat2Grid) loadCategoryGrid(CATEGORY2_API_GENRE, cat2Grid);

  // Genres en dernier : au premier chargement, applique Comedy si dispo puis remplit la grille « Autres »
  if (catSelect && dynamicGrid) {
    loadGenreSelect(catSelect).then(() => {
      reloadDynamicCategory();
    });
  }
});
