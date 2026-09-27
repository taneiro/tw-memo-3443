const sceneTabs = document.getElementById("scene-tabs");
const phraseList = document.getElementById("phrase-list");
const viewTitle = document.getElementById("view-title");
const viewLead = document.getElementById("view-lead");
const voiceBanner = document.getElementById("voice-banner");
const searchForm = document.getElementById("search-form");
const searchInput = document.getElementById("search-input");
const searchClear = document.getElementById("search-clear");
const textSizeBtn = document.getElementById("text-size-btn");
const showOverlay = document.getElementById("show-overlay");
const showPre = document.getElementById("show-pre");
const showZh = document.getElementById("show-zh");
const showPinyin = document.getElementById("show-pinyin");
const showJa = document.getElementById("show-ja");
const showPlay = document.getElementById("show-play");
const showClose = document.getElementById("show-close");
const myHotelView = document.getElementById("myhotel-view");
const myHotelCard = document.getElementById("myhotel-card");
const myHotelForm = document.getElementById("myhotel-form");
const hotelCancel = document.getElementById("hotel-cancel");
const offlineStatus = document.getElementById("offline-status");
const myPhraseView = document.getElementById("myphrase-view");
const myPhraseAdd = document.getElementById("myphrase-add");
const myPhraseForm = document.getElementById("myphrase-form");
const myPhraseCancel = document.getElementById("myphrase-cancel");

const NO_TAIWAN_VOICE_MESSAGE = "台湾華語の音声がこの端末で利用できません";
const TAIWAN_LANG = "zh-TW";
const FAVORITES_ID = "favorites";
const MYHOTEL_ID = "myhotel";
const MYPHRASES_ID = "myphrases";
const MY_SCENE = { id: MYPHRASES_ID, title: "マイフレーズ", icon: "✏️" };

const STORAGE_KEYS = {
  favorites: "twPhrases.favorites",
  scene: "twPhrases.scene",
  largeText: "twPhrases.largeText",
  myHotel: "twPhrases.myHotel",
  myPhrases: "twPhrases.myPhrases",
};

// タクシーでホテルに行くときに見せる言葉
const TO_HOTEL = { zh: "請到這家飯店", pinyin: "Qǐng dào zhè jiā fàndiàn", ja: "このホテルまでお願いします" };

/* ---------- 保存（ブラウザ内の記憶。使えない環境でもアプリは動きます） ---------- */

function loadStored(key, fallback) {
  try {
    const raw = window.localStorage.getItem(key);
    return raw === null ? fallback : JSON.parse(raw);
  } catch {
    return fallback;
  }
}

function saveStored(key, value) {
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // 保存できなくても画面の操作は続けられます
  }
}

/* ---------- フレーズのデータ ---------- */

// 各フレーズに「場面ID:繁体字」という固定のキーを付けて、お気に入りの記録に使います
const ALL_PHRASES = SCENES.flatMap((scene) =>
  (PHRASES[scene.id] || []).map((phrase) => ({
    ...phrase,
    key: `${scene.id}:${phrase.zh}`,
    scene,
  }))
);
const PHRASE_BY_KEY = new Map(ALL_PHRASES.map((phrase) => [phrase.key, phrase]));

const state = {
  view: loadStored(STORAGE_KEYS.scene, SCENES[0].id),
  query: "",
  favorites: new Set(loadStored(STORAGE_KEYS.favorites, []).filter((key) => PHRASE_BY_KEY.has(key))),
  overlaySpeech: null,
  myHotel: loadStored(STORAGE_KEYS.myHotel, null),
  editingHotel: false,
  confirmDelete: false,
  myPhrases: loadStoredList(STORAGE_KEYS.myPhrases).filter((item) => item && item.id && item.zh),
  phraseFormOpen: false,
  editingPhraseId: null,
  confirmDeletePhraseId: null,
};

function loadStoredList(key) {
  const value = loadStored(key, []);
  return Array.isArray(value) ? value : [];
}

if (
  ![FAVORITES_ID, MYHOTEL_ID, MYPHRASES_ID].includes(state.view) &&
  !SCENES.some((scene) => scene.id === state.view)
) {
  state.view = SCENES[0].id;
}

/* ---------- 検索用の文字の整え方 ---------- */

function normalizeForSearch(text) {
  return String(text || "")
    .normalize("NFKC")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "") // 拼音の声調記号を外す（xiè → xie）
    .normalize("NFC")
    .replace(/[ぁ-ゖ]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) + 0x60)) // ひらがな → カタカナ
    .replace(/[\s'’、。，,？?！!・（）()／/]/g, "");
}

for (const phrase of ALL_PHRASES) {
  phrase.searchText = normalizeForSearch(
    [phrase.zh, phrase.pinyin, phrase.kana, phrase.ja, phrase.scene.title].join(" ")
  );
}

function searchPhrases(query) {
  const terms = query
    .split(/[\s　]+/)
    .map(normalizeForSearch)
    .filter(Boolean);
  if (!terms.length) return [];
  return [...myPhraseEntries(), ...ALL_PHRASES].filter((phrase) =>
    terms.every((term) => phrase.searchText.includes(term))
  );
}

// 自分で追加したフレーズを、ほかのフレーズと同じ形にそろえます
function myPhraseEntries() {
  return state.myPhrases.map((item) => ({
    zh: item.zh,
    pinyin: item.pinyin || "",
    kana: item.kana || "",
    ja: item.ja || "",
    id: item.id,
    key: `my:${item.id}`,
    scene: MY_SCENE,
    mine: true,
    searchText: normalizeForSearch([item.zh, item.pinyin, item.kana, item.ja, MY_SCENE.title].join(" ")),
  }));
}

function findPhrase(key) {
  return PHRASE_BY_KEY.get(key) || myPhraseEntries().find((phrase) => phrase.key === key);
}

/* ---------- 台湾華語の音声 ---------- */

let cachedTaiwanVoice = null;
let voicesChecked = false;

function normalizeLang(lang) {
  return String(lang || "")
    .toLowerCase()
    .replace(/_/g, "-");
}

function isJapaneseVoice(voice) {
  return normalizeLang(voice.lang).startsWith("ja") || /japanese|haruka|nanami|ichiro|kyoko|otoya/i.test(voice.name);
}

function isTaiwanMandarinVoice(voice) {
  if (!voice || isJapaneseVoice(voice)) return false;

  const lang = normalizeLang(voice.lang);
  if (
    lang === "zh-tw" ||
    lang.startsWith("zh-tw-") ||
    lang === "zh-hant-tw" ||
    lang.startsWith("zh-hant-tw") ||
    lang === "cmn-tw" ||
    lang.startsWith("cmn-hant-tw")
  ) {
    return true;
  }

  const taiwanName =
    /taiwan|hanhan|yating|zhiwei|mei-?jia|hsiaoyu|hsiaochen|yunjhe|國語（臺灣）|國語 \(臺灣\)|中文（台灣）|chinese \(taiwan\)|mandarin.*taiwan|taiwan.*mandarin/i.test(
      voice.name
    );
  return taiwanName && (lang.startsWith("zh") || lang.startsWith("cmn"));
}

function scoreTaiwanVoice(voice) {
  if (!isTaiwanMandarinVoice(voice)) return -1;
  const lang = normalizeLang(voice.lang);
  let score = 0;
  if (lang === "zh-tw" || lang === "zh-hant-tw" || lang === "cmn-hant-tw") score += 100;
  else if (lang.startsWith("zh-tw") || lang.startsWith("zh-hant-tw") || lang.startsWith("cmn")) score += 90;
  else score += 70;
  if (/natural|online|neural/i.test(voice.name)) score += 8;
  return score;
}

function pickTaiwanVoice(voices) {
  return voices
    .map((voice) => ({ voice, score: scoreTaiwanVoice(voice) }))
    .filter((item) => item.score >= 0)
    .sort((a, b) => b.score - a.score)[0]?.voice ?? null;
}

function loadVoices() {
  if (!("speechSynthesis" in window)) return Promise.resolve([]);
  const current = window.speechSynthesis.getVoices();
  if (current.length) return Promise.resolve(current);

  return new Promise((resolve) => {
    const finish = () => resolve(window.speechSynthesis.getVoices());
    window.speechSynthesis.addEventListener("voiceschanged", finish, { once: true });
    window.setTimeout(finish, 800);
  });
}

async function refreshTaiwanVoice() {
  const voices = await loadVoices();
  cachedTaiwanVoice = pickTaiwanVoice(voices);
  voicesChecked = true;
  updateVoiceBanner();
  return cachedTaiwanVoice;
}

function updateVoiceBanner() {
  if (!voicesChecked) return;
  if (cachedTaiwanVoice) {
    voiceBanner.hidden = true;
    voiceBanner.innerHTML = "";
    return;
  }
  voiceBanner.hidden = false;
  voiceBanner.innerHTML = `
    <p class="voice-banner-title">⚠️ ${NO_TAIWAN_VOICE_MESSAGE}</p>
    <p>発音ボタンは台湾華語の声だけを使うため、別の言語の声では再生しません。カタカナ読みを目安にしてください。</p>
    <details>
      <summary>音声を追加する方法</summary>
      <ul>
        <li><b>iPhone：</b>設定 → アクセシビリティ → 読み上げコンテンツ → 声 → 中国語（台湾）を追加</li>
        <li><b>Android：</b>設定 → 「テキスト読み上げ」で検索 → 優先エンジン（Google）の設定 → 音声データをインストール → 中国語（台湾）</li>
        <li><b>Windows：</b>設定 → 時刻と言語 → 音声 → 音声を追加 → 中国語（台湾）</li>
      </ul>
      <p>追加したら、このページを再読み込みしてください。</p>
    </details>
  `;
}

function showStatus(button, message) {
  const card = button.closest(".phrase-card, .show-inner");
  if (!card) return;
  let status = card.querySelector(".status");
  if (!status) {
    status = document.createElement("p");
    status.className = "status";
    status.setAttribute("role", "status");
    card.appendChild(status);
  }
  status.textContent = message;
}

function clearStatus(button) {
  const status = button.closest(".phrase-card, .show-inner")?.querySelector(".status");
  if (status) status.remove();
}

async function speakTaiwanMandarin(hanzi, button) {
  if (!("speechSynthesis" in window)) {
    showStatus(button, "このブラウザでは音声再生に対応していません。");
    return;
  }

  const voice = cachedTaiwanVoice || (await refreshTaiwanVoice());
  if (!voice) {
    showStatus(button, NO_TAIWAN_VOICE_MESSAGE);
    return;
  }

  clearStatus(button);
  window.speechSynthesis.cancel();

  const utterance = new SpeechSynthesisUtterance(hanzi);
  utterance.voice = voice;
  utterance.lang = TAIWAN_LANG;
  utterance.rate = 0.92;
  utterance.pitch = 1;
  utterance.volume = 1;

  utterance.onstart = () => button.setAttribute("aria-pressed", "true");
  utterance.onend = () => button.setAttribute("aria-pressed", "false");
  utterance.onerror = () => {
    button.setAttribute("aria-pressed", "false");
    showStatus(button, NO_TAIWAN_VOICE_MESSAGE);
  };

  window.speechSynthesis.speak(utterance);
}

/* ---------- 画面の描画 ---------- */

function escapeHtml(text) {
  return String(text).replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[ch]);
}

function renderTabs() {
  const tabs = [
    { id: FAVORITES_ID, icon: "★", title: "お気に入り", count: state.favorites.size },
    { id: MYHOTEL_ID, icon: "📍", title: "マイホテル" },
    { id: MYPHRASES_ID, icon: MY_SCENE.icon, title: MY_SCENE.title, count: state.myPhrases.length },
    ...SCENES.map((scene) => ({ id: scene.id, icon: scene.icon, title: scene.title })),
  ];
  const searching = state.query.trim() !== "";

  sceneTabs.innerHTML = tabs
    .map((tab) => {
      const active = !searching && tab.id === state.view;
      const count = tab.count !== undefined ? `<span class="tab-count">${tab.count}</span>` : "";
      return `
        <button class="tab${tab.id === FAVORITES_ID ? " tab-fav" : ""}" type="button" data-view="${tab.id}"
          aria-pressed="${active}">
          <span class="tab-icon" aria-hidden="true">${tab.icon}</span>${escapeHtml(tab.title)}${count}
        </button>`;
    })
    .join("");
}

function phraseCardHtml(phrase, showSceneTag) {
  const isFav = state.favorites.has(phrase.key);
  const key = escapeHtml(phrase.key);
  const tag = showSceneTag
    ? `<p class="scene-tag"><span aria-hidden="true">${phrase.scene.icon}</span> ${escapeHtml(phrase.scene.title)}</p>`
    : "";
  const rows = [
    phrase.pinyin ? `<div><dt>拼音</dt><dd>${escapeHtml(phrase.pinyin)}</dd></div>` : "",
    phrase.kana ? `<div><dt>カタカナ</dt><dd>${escapeHtml(phrase.kana)}</dd></div>` : "",
  ].join("");
  const confirming = phrase.mine && state.confirmDeletePhraseId === phrase.id;
  // 自分で追加したフレーズには ☆ の代わりに「書き換える」「消す」を付けます
  const extra = phrase.mine
    ? `<div class="actions actions-2">
        <button class="btn btn-close" type="button" data-action="edit" data-key="${key}">✏️ 書き換える</button>
        <button class="btn btn-delete${confirming ? " is-confirm" : ""}" type="button" data-action="delete" data-key="${key}">
          ${confirming ? "本当に消す？（もう一度押す）" : "🗑️ 消す"}
        </button>
      </div>`
    : "";
  return `
    <article class="phrase-card">
      ${tag}
      ${phrase.ja ? `<p class="ja">${escapeHtml(phrase.ja)}</p>` : ""}
      <p class="zh" lang="zh-Hant-TW">${escapeHtml(phrase.zh)}</p>
      ${rows ? `<dl class="meta">${rows}</dl>` : ""}
      <div class="actions${phrase.mine ? " actions-2" : ""}">
        <button class="btn btn-play" type="button" data-action="play" data-key="${key}" aria-pressed="false"
          aria-label="${escapeHtml(phrase.zh)} を台湾華語で発音">🔊 発音</button>
        <button class="btn btn-show" type="button" data-action="show" data-key="${key}"
          aria-label="${escapeHtml(phrase.zh)} を大きく表示">見せる</button>
        ${
          phrase.mine
            ? ""
            : `<button class="btn btn-fav" type="button" data-action="fav" data-key="${key}" aria-pressed="${isFav}"
          aria-label="お気に入り">${isFav ? "★" : "☆"}</button>`
        }
      </div>
      ${extra}
    </article>`;
}

/* ---------- マイフレーズ ---------- */

function openPhraseForm(entry) {
  state.phraseFormOpen = true;
  state.editingPhraseId = entry ? entry.id : null;
  myPhraseForm.elements.ja.value = entry?.ja || "";
  myPhraseForm.elements.zh.value = entry?.zh || "";
  myPhraseForm.elements.pinyin.value = entry?.pinyin || "";
  myPhraseForm.elements.kana.value = entry?.kana || "";
  renderPhraseForm();
  myPhraseForm.scrollIntoView({ behavior: "smooth", block: "start" });
  myPhraseForm.elements.ja.focus({ preventScroll: true });
}

function closePhraseForm() {
  state.phraseFormOpen = false;
  state.editingPhraseId = null;
  renderPhraseForm();
}

function renderPhraseForm() {
  myPhraseForm.hidden = !state.phraseFormOpen;
  myPhraseAdd.hidden = state.phraseFormOpen;
}

function saveMyPhrases() {
  saveStored(STORAGE_KEYS.myPhrases, state.myPhrases);
}

myPhraseAdd.addEventListener("click", () => openPhraseForm(null));
myPhraseCancel.addEventListener("click", closePhraseForm);

myPhraseForm.addEventListener("submit", (event) => {
  event.preventDefault();
  const value = (name) => myPhraseForm.elements[name].value.trim();
  if (!value("ja")) return myPhraseForm.elements.ja.focus();
  if (!value("zh")) return myPhraseForm.elements.zh.focus();

  const item = { ja: value("ja"), zh: value("zh"), pinyin: value("pinyin"), kana: value("kana") };
  const index = state.myPhrases.findIndex((phrase) => phrase.id === state.editingPhraseId);
  if (index >= 0) {
    state.myPhrases[index] = { ...state.myPhrases[index], ...item };
  } else {
    item.id = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
    state.myPhrases.unshift(item); // 新しいものを上に
  }
  saveMyPhrases();
  closePhraseForm();
  render();
  window.scrollTo({ top: 0, behavior: "smooth" });
});

function deleteMyPhrase(phrase) {
  if (state.confirmDeletePhraseId !== phrase.id) {
    state.confirmDeletePhraseId = phrase.id; // 誤って消さないよう、2回押したときだけ消す
    render();
    return;
  }
  state.confirmDeletePhraseId = null;
  state.myPhrases = state.myPhrases.filter((item) => item.id !== phrase.id);
  saveMyPhrases();
  render();
}

/* ---------- マイホテル ---------- */

function renderMyHotel() {
  const hotel = state.myHotel;
  const editing = state.editingHotel || !hotel;

  myHotelForm.hidden = !editing;
  myHotelCard.hidden = editing;
  hotelCancel.hidden = !hotel; // まだ登録がないときは「やめる」は不要

  if (editing) {
    myHotelForm.elements.zh.value = hotel?.zh || "";
    myHotelForm.elements.address.value = hotel?.address || "";
    myHotelForm.elements.phone.value = hotel?.phone || "";
    myHotelForm.elements.memo.value = hotel?.memo || "";
    return;
  }

  const rows = [
    hotel.phone ? `<div><dt>電話</dt><dd>${escapeHtml(hotel.phone)}</dd></div>` : "",
    hotel.memo ? `<div><dt>メモ</dt><dd>${escapeHtml(hotel.memo)}</dd></div>` : "",
  ].join("");

  myHotelCard.innerHTML = `
    <p class="ja">${escapeHtml(TO_HOTEL.ja)}</p>
    <p class="hotel-pre" lang="zh-Hant-TW">${escapeHtml(TO_HOTEL.zh)}</p>
    <p class="zh" lang="zh-Hant-TW">${escapeHtml(hotel.zh)}</p>
    ${hotel.address ? `<p class="hotel-address" lang="zh-Hant-TW">${escapeHtml(hotel.address)}</p>` : ""}
    ${rows ? `<dl class="meta">${rows}</dl>` : ""}
    <div class="actions actions-2">
      <button class="btn btn-play" type="button" data-hotel="play" aria-pressed="false">🔊 発音</button>
      <button class="btn btn-show" type="button" data-hotel="show">見せる</button>
    </div>
    <div class="actions actions-2">
      <button class="btn btn-close" type="button" data-hotel="edit">✏️ 書き換える</button>
      <button class="btn btn-delete${state.confirmDelete ? " is-confirm" : ""}" type="button" data-hotel="delete">
        ${state.confirmDelete ? "本当に消す？（もう一度押す）" : "🗑️ 消す"}
      </button>
    </div>`;
}

function hotelSpeech() {
  return `請到${state.myHotel.zh}`;
}

myHotelCard.addEventListener("click", (event) => {
  const button = event.target.closest("[data-hotel]");
  if (!button || !state.myHotel) return;
  const action = button.dataset.hotel;

  if (action !== "delete") state.confirmDelete = false;

  if (action === "play") {
    speakTaiwanMandarin(hotelSpeech(), button);
  } else if (action === "show") {
    openOverlay({
      pre: TO_HOTEL.zh,
      zh: state.myHotel.zh,
      sub: state.myHotel.address || "",
      ja: [TO_HOTEL.ja, state.myHotel.phone ? `電話 ${state.myHotel.phone}` : ""].filter(Boolean).join("\n"),
      speech: hotelSpeech(),
    });
  } else if (action === "edit") {
    state.editingHotel = true;
    renderMyHotel();
    myHotelForm.elements.zh.focus();
  } else if (action === "delete") {
    if (!state.confirmDelete) {
      state.confirmDelete = true; // 誤って消さないよう、2回押したときだけ消す
      renderMyHotel();
      return;
    }
    state.confirmDelete = false;
    state.myHotel = null;
    try {
      window.localStorage.removeItem(STORAGE_KEYS.myHotel);
    } catch {
      // 保存できない環境では何もしない
    }
    renderMyHotel();
  }
});

myHotelForm.addEventListener("submit", (event) => {
  event.preventDefault();
  const value = (name) => myHotelForm.elements[name].value.trim();
  if (!value("zh")) {
    myHotelForm.elements.zh.focus();
    return;
  }
  state.myHotel = { zh: value("zh"), address: value("address"), phone: value("phone"), memo: value("memo") };
  state.editingHotel = false;
  saveStored(STORAGE_KEYS.myHotel, state.myHotel);
  renderMyHotel();
  window.scrollTo({ top: 0, behavior: "smooth" });
});

hotelCancel.addEventListener("click", () => {
  state.editingHotel = false;
  renderMyHotel();
});

/* ---------- 一覧の描画 ---------- */

function render() {
  const query = state.query.trim();
  let phrases;
  let showSceneTag;
  const showMyHotel = !query && state.view === MYHOTEL_ID;
  const showMyPhrases = !query && state.view === MYPHRASES_ID;

  phraseList.hidden = showMyHotel;
  myHotelView.hidden = !showMyHotel;
  myPhraseView.hidden = !showMyPhrases;
  if (!showMyPhrases && state.phraseFormOpen) closePhraseForm();

  if (showMyHotel) {
    viewTitle.textContent = "📍 マイホテル";
    viewLead.textContent =
      "泊まるホテルを登録しておくと、タクシーで「見せる」だけで行き先を伝えられます。英語名だと伝わらないことが多いので、中国語の名前と住所を入れましょう。";
    state.confirmDelete = false;
    renderMyHotel();
    renderTabs();
    return;
  }

  if (query) {
    phrases = searchPhrases(query);
    showSceneTag = true;
    viewTitle.textContent = `「${query}」の検索結果`;
    viewLead.textContent = phrases.length
      ? `すべての場面から ${phrases.length} 件見つかりました。`
      : "見つかりませんでした。日本語（例：トイレ）、繁体字、拼音（例：xiexie）、カタカナでも探せます。";
  } else if (state.view === FAVORITES_ID) {
    phrases = ALL_PHRASES.filter((phrase) => state.favorites.has(phrase.key));
    showSceneTag = true;
    viewTitle.textContent = "★ お気に入り";
    viewLead.textContent = phrases.length
      ? "よく使うフレーズをまとめています。☆ をもう一度押すと外せます。"
      : "まだありません。各フレーズの ☆ を押すと、ここに集まります。";
  } else if (showMyPhrases) {
    phrases = myPhraseEntries();
    showSceneTag = false;
    viewTitle.textContent = `${MY_SCENE.icon} ${MY_SCENE.title}`;
    viewLead.textContent = phrases.length
      ? "自分で追加したフレーズです。このスマホの中だけに保存されています。"
      : "まだありません。「＋ 新しいフレーズを追加」から、自分の使いたい言葉を登録できます。";
    renderPhraseForm();
  } else {
    const scene = SCENES.find((item) => item.id === state.view);
    phrases = ALL_PHRASES.filter((phrase) => phrase.scene.id === scene.id);
    showSceneTag = false;
    viewTitle.textContent = `${scene.icon} ${scene.title}`;
    viewLead.textContent = scene.lead;
  }

  phraseList.innerHTML = phrases.map((phrase) => phraseCardHtml(phrase, showSceneTag)).join("");
  renderTabs();
}

function scrollActiveTabIntoView() {
  const active = sceneTabs.querySelector('[aria-pressed="true"]');
  if (!active) return;
  const left = active.offsetLeft - (sceneTabs.clientWidth - active.offsetWidth) / 2;
  sceneTabs.scrollTo({ left, behavior: "smooth" });
}

/* ---------- 操作 ---------- */

function setView(viewId) {
  window.speechSynthesis?.cancel();
  state.view = viewId;
  state.query = "";
  searchInput.value = "";
  searchClear.hidden = true;
  saveStored(STORAGE_KEYS.scene, viewId);
  render();
  scrollActiveTabIntoView();
  window.scrollTo({ top: 0, behavior: "smooth" });
}

function toggleFavorite(key, button) {
  if (state.favorites.has(key)) state.favorites.delete(key);
  else state.favorites.add(key);
  saveStored(STORAGE_KEYS.favorites, [...state.favorites]);

  if (state.view === FAVORITES_ID && !state.query.trim()) {
    render(); // お気に入り一覧から外したときは一覧を作り直す
    return;
  }
  const isFav = state.favorites.has(key);
  button.setAttribute("aria-pressed", String(isFav));
  button.textContent = isFav ? "★" : "☆";
  renderTabs();
}

// content: { pre?, zh, sub, ja, speech }
function openOverlay(content) {
  state.overlaySpeech = content.speech;
  showPre.hidden = !content.pre;
  showPre.textContent = content.pre || "";
  showZh.textContent = content.zh;
  showPinyin.textContent = content.sub;
  showJa.textContent = content.ja;
  clearStatus(showPlay);
  showOverlay.hidden = false;
  document.body.classList.add("no-scroll");
  // スマホの「戻る」操作で閉じられるように履歴を1つ追加します
  history.pushState({ overlay: true }, "");
  showClose.focus();
}

function closeOverlay({ fromHistory = false } = {}) {
  if (showOverlay.hidden) return;
  window.speechSynthesis?.cancel();
  showOverlay.hidden = true;
  document.body.classList.remove("no-scroll");
  state.overlaySpeech = null;
  if (!fromHistory && history.state?.overlay) history.back();
}

function applyTextSize(large) {
  document.documentElement.classList.toggle("large-text", large);
  textSizeBtn.setAttribute("aria-pressed", String(large));
  textSizeBtn.querySelector("span").textContent = large ? "小" : "大";
  textSizeBtn.setAttribute("aria-label", large ? "文字を標準の大きさに戻す" : "文字を大きくする");
}

sceneTabs.addEventListener("click", (event) => {
  const tab = event.target.closest("[data-view]");
  if (tab) setView(tab.dataset.view);
});

phraseList.addEventListener("click", (event) => {
  let button = event.target.closest("[data-action]");
  if (!button) return;
  const phrase = findPhrase(button.dataset.key);
  if (!phrase) return;
  const action = button.dataset.action;

  if (action !== "delete" && state.confirmDeletePhraseId) {
    state.confirmDeletePhraseId = null;
    render();
    if (action === "edit") return openPhraseFormFor(phrase);
    // 再描画でボタンが作り直されるので、押したボタンを探し直す
    const again = phraseList.querySelector(`[data-action="${action}"][data-key="${CSS.escape(phrase.key)}"]`);
    if (again) button = again;
  }

  if (action === "play") speakTaiwanMandarin(phrase.zh, button);
  else if (action === "show") openOverlay({ zh: phrase.zh, sub: phrase.pinyin, ja: phrase.ja, speech: phrase.zh });
  else if (action === "fav") toggleFavorite(phrase.key, button);
  else if (action === "edit") openPhraseFormFor(phrase);
  else if (action === "delete") deleteMyPhrase(phrase);
});

function openPhraseFormFor(phrase) {
  if (state.view !== MYPHRASES_ID || state.query.trim()) setView(MYPHRASES_ID);
  openPhraseForm(phrase);
}

searchInput.addEventListener("input", () => {
  state.query = searchInput.value;
  searchClear.hidden = searchInput.value === "";
  render();
});

searchForm.addEventListener("submit", (event) => {
  event.preventDefault();
  searchInput.blur(); // スマホのキーボードを閉じて結果を見やすくする
});

searchClear.addEventListener("click", () => {
  searchInput.value = "";
  state.query = "";
  searchClear.hidden = true;
  render();
  searchInput.focus();
});

textSizeBtn.addEventListener("click", () => {
  const large = !document.documentElement.classList.contains("large-text");
  applyTextSize(large);
  saveStored(STORAGE_KEYS.largeText, large);
});

showPlay.addEventListener("click", () => {
  if (state.overlaySpeech) speakTaiwanMandarin(state.overlaySpeech, showPlay);
});
showClose.addEventListener("click", () => closeOverlay());
showOverlay.addEventListener("click", (event) => {
  if (event.target === showOverlay) closeOverlay();
});
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") closeOverlay();
});
window.addEventListener("popstate", () => closeOverlay({ fromHistory: true }));

/* ---------- 起動 ---------- */

if ("speechSynthesis" in window) {
  window.speechSynthesis.addEventListener("voiceschanged", () => {
    cachedTaiwanVoice = pickTaiwanVoice(window.speechSynthesis.getVoices());
    voicesChecked = true;
    updateVoiceBanner();
  });
  refreshTaiwanVoice();
} else {
  voicesChecked = true;
  updateVoiceBanner();
}

// 電波がなくても使えるように、アプリのファイルをこの端末に保存します（https で開いたときだけ動きます）
function setupOffline() {
  if (!("serviceWorker" in navigator) || !window.isSecureContext) {
    offlineStatus.textContent = "⚠️ この開き方では、電波がないと使えません（https のURLで開くと保存されます）。";
    offlineStatus.classList.add("is-warn");
    return;
  }
  navigator.serviceWorker
    .register("sw.js")
    .then(() => navigator.serviceWorker.ready)
    .then(() => {
      offlineStatus.textContent = "✅ この端末に保存済みです。電波がなくても使えます。";
      offlineStatus.classList.add("is-ok");
    })
    .catch(() => {
      offlineStatus.textContent = "⚠️ この端末への保存に失敗しました。電波のある場所でもう一度開いてください。";
      offlineStatus.classList.add("is-warn");
    });
}

applyTextSize(loadStored(STORAGE_KEYS.largeText, false) === true);
render();
scrollActiveTabIntoView();
setupOffline();
