/*jshint esversion: 6 */
// @ts-check

/*
 * Aquarium Game (P3) - Shop UI
 *
 * goals:
 * - shop only (coins + buy/sell)
 * - floating modal panel (no scroll)
 * - compact header so grid has space
 * - cards always fully visible (no footer clipping)
 * - the "gap" becomes extra thumbnail height instead
 * - subtle shimmer on thumbnails
 * - 6 items per page (3x2 grid)
 *
 * behaviour:
 * - when the shop button is clicked, always default to:
 *   tab = buy, buyCategory = eggs, page = 0
 * - do not reset on reload
 */

export class ShopUI {
  /**
   * @param {object} opts
   * @param {{ coins:number }} opts.state
   * @param {{ eggs: Array<any>, decor: Array<any>, sell: Array<any> }} opts.data
   * @param {(nextCoins:number)=>void} [opts.onCoinsChanged]
   * @param {(type:string, detail:any)=>void} [opts.onUIEvent]
   * @param {(item:any)=>HTMLElement|null} [opts.getThumbNode]
   * @param {(item:any)=>void} [opts.onBuyItem]
   * @param {(item:any)=>void} [opts.onSellItem]
   */
  constructor(opts) {
    this.state = opts.state || { coins: 0 };
    this.data = opts.data || { eggs: [], decor: [], sell: [] };
    this.onCoinsChanged = opts.onCoinsChanged || null;
    this.onUIEvent = (typeof opts.onUIEvent === "function") ? opts.onUIEvent : null;

    this.getThumbNode = (typeof opts.getThumbNode === "function") ? opts.getThumbNode : null;
    this.onBuyItem = (typeof opts.onBuyItem === "function") ? opts.onBuyItem : null;
    this.onSellItem = (typeof opts.onSellItem === "function") ? opts.onSellItem : null;

    this.open = false;
    this.tab = "buy";
    this.buyCategory = "eggs";
    this.page = 0;

    this._anchorRect = null;

    this._root = null;
    this._overlay = null;
    this._panel = null;
    this._grid = null;

    this._coinsText = null;
    this._pageText = null;
    this._prevBtn = null;
    this._nextBtn = null;

    this._buyBtn = null;
    this._sellBtn = null;
    this._eggsBtn = null;
    this._decorBtn = null;

    // tutorial-friendly direct refs
    this._shopBtn = null;
    this._closeBtn = null;

    this._shopBtn = null;
    this._closeBtn = null;

    this._launcher = null;

    this._disposableKeyHandler = null;

    this._ensureGlobalStyles();
    this._build();
    this._sync();
  }

  mount(parent = document.body) {
    if (!this._root) return;
    parent.appendChild(this._root);
    this._syncAnchor();
  }

  dispose() {
    if (this._disposableKeyHandler) {
      window.removeEventListener("keydown", this._disposableKeyHandler);
      this._disposableKeyHandler = null;
    }
    if (this._root) this._root.remove();
    this._root = null;
  }

  /**
   * @param {DOMRect} rect
   */
  setAnchorRect(rect) {
    this._anchorRect = rect || null;
    this._syncAnchor();
  }

  setCoins(coins) {
    this.state.coins = Math.max(0, Math.floor(coins));
    this._sync();
  }

  addCoins(delta) {
    this.setCoins(this.state.coins + delta);
    if (this.onCoinsChanged) this.onCoinsChanged(this.state.coins);
  }

  setOpen(open) {
    const next = !!open;
    const changed = (next !== this.open);
    this.open = next;
    this._sync();
    if (changed) this._emit("open", { open: this.open, tab: this.tab, buyCategory: this.buyCategory, page: this.page });
  }

  toggleOpen() {
    this.setOpen(!this.open);
  }

  refresh() {
    this._sync();
  }

  /* ------------------------------------------------------------------ */
  /* tutorial helpers                                                    */
  /* ------------------------------------------------------------------ */

  /**
   * @param {string} key
   * @returns {HTMLElement|null}
   */
  getTutorialElement(key) {
    if (!this._root) return null;
    return /** @type {HTMLElement|null} */ (this._root.querySelector(`[data-aq-tut="${String(key)}"]`));
  }

  /**
   * @param {string} key
   * @param {boolean} on
   */
  setTutorialPulse(key, on) {
    const el = this.getTutorialElement(key);
    if (!el) return;
    el.classList.toggle("aq-tutPulse", !!on);
  }

  _emit(type, detail = {}) {
    if (this.onUIEvent) this.onUIEvent(String(type), detail || {});
  }

  /**
   * Convenience: sell an item by shop item id (used by optional pick-to-sell).
   * @param {string} id
   */
  sellById(id) {
    const it = (this.data && this.data.sell) ? this.data.sell.find((x) => x && x.id === id) : null;
    if (!it) return;
    this.tab = "sell";
    this._sync();

    // click the specific card button for this id if present
    const btn = this.getTutorialElement(`sell_item:${String(id)}`);
    if (btn && typeof btn.click === "function") btn.click();
  }

  /* ------------------------------------------------------------------ */

  _el(tag) {
    return document.createElement(tag);
  }

  _btn(label, cls = "aq-btn") {
    const b = /** @type {HTMLButtonElement} */ (document.createElement("button"));
    b.type = "button";
    b.textContent = label;
    b.className = cls;
    return b;
  }

  _ensureGlobalStyles() {
    if (document.getElementById("aq-shop-styles")) return;

    const style = document.createElement("style");
    style.id = "aq-shop-styles";
    style.textContent = `
      :root{
        --aq-panel-bg: rgba(10, 14, 20, 0.82);
        --aq-stroke: rgba(255,255,255,0.12);
        --aq-text: #eef7ff;
        --aq-sub: rgba(238,247,255,0.76);
        --aq-accent: rgba(150, 220, 255, 0.28);
        --aq-accent2: rgba(150, 220, 255, 0.18);
        --aq-shadow: 0 18px 70px rgba(0,0,0,0.50);
      }

      .aq-ui-root{
        position: fixed;
        inset: 0;
        pointer-events: none;
        z-index: 50;
        font-family: system-ui, -apple-system, Segoe UI, Roboto, sans-serif;
        color: var(--aq-text);
      }

      .aq-launcher{
        position: fixed;
        pointer-events: auto;
        z-index: 51;
      }

      .aq-btn{
        border: 1px solid var(--aq-stroke);
        background: rgba(10, 14, 20, 0.55);
        color: var(--aq-text);
        border-radius: 14px;
        padding: 7px 10px;
        font-size: 14px;
        cursor: pointer;
        backdrop-filter: blur(12px);
        -webkit-backdrop-filter: blur(12px);
        transition: transform 120ms ease, background 120ms ease, border-color 120ms ease;
      }

      .aq-btn:hover{
        transform: translateY(-1px);
        background: rgba(16, 22, 32, 0.62);
        border-color: rgba(255,255,255,0.18);
      }

      .aq-btn:active{ transform: translateY(0px); }

      .aq-btn:disabled{
        opacity: 0.55;
        cursor: default;
        transform: none;
      }

      .aq-btnPill{
        border-radius: 999px;
        padding: 7px 11px;
      }

      .aq-btnPill.aq-active{
        background: var(--aq-accent2);
        border-color: var(--aq-accent);
      }

      .aq-overlay{
        position: fixed;
        inset: 0;
        background: rgba(0,0,0,0.46);
        backdrop-filter: blur(7px);
        -webkit-backdrop-filter: blur(7px);
        pointer-events: auto;
      }

      .aq-panel{
        position: fixed;
        left: 50%;
        top: 50%;
        transform: translate(-50%, -50%);
        width: min(900px, calc(100vw - 40px));
        height: min(760px, calc(100vh - 24px));
        border-radius: 26px;
        background: var(--aq-panel-bg);
        border: 1px solid var(--aq-stroke);
        box-shadow: var(--aq-shadow);
        overflow: hidden;
        pointer-events: auto;

        display: grid;
        grid-template-rows: auto auto 1fr;
      }

      .aq-top{
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: 10px 14px;
        border-bottom: 1px solid rgba(255,255,255,0.08);
        background: rgba(255,255,255,0.03);
      }

      .aq-title{
        font-weight: 900;
        letter-spacing: 0.2px;
        font-size: 16px;
      }

      .aq-topRight{
        display: flex;
        align-items: center;
        gap: 8px;
      }

      .aq-coinPill{
        display: inline-flex;
        align-items: center;
        gap: 8px;
        padding: 6px 10px;
        border-radius: 999px;
        border: 1px solid rgba(255,255,255,0.12);
        background: rgba(0,0,0,0.18);
      }

      .aq-coinIcon{
        width: 16px;
        height: 16px;
        border-radius: 50%;
        background: radial-gradient(circle at 30% 30%, rgba(255,255,255,0.8), rgba(255,255,255,0.0) 40%),
                    radial-gradient(circle at 55% 60%, rgba(255,220,120,0.9), rgba(210,140,30,0.9));
        box-shadow: 0 2px 10px rgba(255,200,80,0.16);
      }

      .aq-coinText{
        font-weight: 900;
        font-variant-numeric: tabular-nums;
        font-size: 14px;
      }

      .aq-bar{
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 10px;
        padding: 8px 14px;
        border-bottom: 1px solid rgba(255,255,255,0.08);
        background: rgba(255,255,255,0.02);
      }

      .aq-barLeft{
        display: flex;
        align-items: center;
        gap: 10px;
        min-width: 0;
        flex-wrap: wrap;
      }

      .aq-seg{
        display: inline-flex;
        align-items: center;
        gap: 6px;
        padding: 5px;
        border-radius: 999px;
        border: 1px solid rgba(255,255,255,0.10);
        background: rgba(0,0,0,0.16);
      }

      .aq-barRight{
        display: flex;
        align-items: center;
        gap: 8px;
        flex-shrink: 0;
      }

      .aq-pageText{
        font-size: 12px;
        color: var(--aq-sub);
        font-variant-numeric: tabular-nums;
        min-width: 90px;
        text-align: center;
      }

      .aq-gridWrap{
        padding: 12px 14px 18px 14px;
        overflow: hidden;
        min-height: 0;
      }

      .aq-grid{
        height: 100%;
        display: grid;
        grid-template-columns: repeat(3, minmax(0, 1fr));
        grid-template-rows: repeat(2, minmax(0, 1fr));
        gap: 12px;
      }

      @media (max-width: 820px){
        .aq-panel{ width: min(900px, calc(100vw - 20px)); }
        .aq-grid{
          grid-template-columns: repeat(2, minmax(0, 1fr));
          grid-template-rows: repeat(3, minmax(0, 1fr));
        }
      }

      @media (max-width: 460px){
        .aq-panel{ height: min(840px, calc(100vh - 24px)); }
        .aq-grid{
          grid-template-columns: repeat(1, minmax(0, 1fr));
          grid-template-rows: repeat(6, minmax(0, 1fr));
        }
      }

      .aq-card{
        background: rgba(255,255,255,0.045);
        border: 1px solid rgba(255,255,255,0.11);
        border-radius: 20px;

        padding: 10px 10px 12px 10px;
        display: flex;
        flex-direction: column;
        gap: 6px;

        box-shadow: 0 10px 24px rgba(0,0,0,0.16);
        overflow: hidden;
        min-height: 0;
      }

      .aq-thumb{
        position: relative;
        flex: 1 1 auto;
        min-height: 110px;
        border-radius: 16px;
        background:
          radial-gradient(circle at 30% 20%, rgba(255,255,255,0.14), rgba(255,255,255,0.00) 55%),
          radial-gradient(circle at 70% 65%, rgba(140, 220, 255, 0.14), rgba(255,255,255,0.00) 58%),
          rgba(0,0,0,0.16);
        border: 1px dashed rgba(255,255,255,0.16);
        display: grid;
        place-items: center;
        color: rgba(238,247,255,0.75);
        font-weight: 900;
        letter-spacing: 1px;
        user-select: none;
        overflow: hidden;
      }

      /* SELL THUMB PNG CLOSEUP */
      .aq-thumbImg{
        width: 100%;
        height: 100%;
        object-fit: cover;
        object-position: 50% 50%;
        display: block;
        transform: scale(1.06);
      }

      .aq-thumbHasImg{
        border: 1px solid rgba(255,255,255,0.11);
      }

      .aq-thumb::after{
        content: "";
        position: absolute;
        inset: -40% -60%;
        background: linear-gradient(
          115deg,
          rgba(255,255,255,0.00) 0%,
          rgba(255,255,255,0.05) 35%,
          rgba(170, 235, 255, 0.10) 50%,
          rgba(255,255,255,0.05) 65%,
          rgba(255,255,255,0.00) 100%
        );
        transform: translateX(-40%) translateY(0%) rotate(0deg);
        animation: aqShimmer 4.6s ease-in-out infinite;
        pointer-events: none;
        mix-blend-mode: screen;
        opacity: 0.9;
      }

      @keyframes aqShimmer{
        0%   { transform: translateX(-55%) translateY(-10%); opacity: 0.0; }
        18%  { opacity: 0.75; }
        45%  { transform: translateX(20%) translateY(10%); opacity: 0.55; }
        70%  { opacity: 0.15; }
        100% { transform: translateX(55%) translateY(18%); opacity: 0.0; }
      }

      .aq-name{
        font-weight: 900;
        line-height: 1.1;
        font-size: 15px;
        margin: 2px 0 0 0;
        flex: 0 0 auto;
      }

      .aq-desc{
        font-size: 12px;
        color: var(--aq-sub);
        line-height: 1.2;
        margin: 0;
        flex: 0 0 auto;

        overflow: hidden;
        display: -webkit-box;
        -webkit-line-clamp: 1;
        -webkit-box-orient: vertical;
      }

      .aq-priceRow{
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 10px;

        margin-top: auto;
        padding-top: 6px;

        flex: 0 0 auto;
      }

      .aq-price{
        display: inline-flex;
        align-items: center;
        gap: 8px;
        padding: 6px 10px;
        border-radius: 999px;
        background: rgba(255,255,255,0.06);
        border: 1px solid rgba(255,255,255,0.10);
        font-weight: 900;
        font-variant-numeric: tabular-nums;
      }

      .aq-cardBtn{
        border-radius: 999px;
        padding: 6px 11px;
        font-size: 13px;
        font-weight: 900;
      }

      @keyframes aqTutPulse{
        0%{ box-shadow: 0 0 0 0 rgba(255,255,255,0.00), 0 0 0 0 rgba(120,210,255,0.00); transform: translateZ(0) scale(1); }
        50%{ box-shadow: 0 0 0 6px rgba(255,255,255,0.12), 0 0 0 12px rgba(120,210,255,0.10); transform: translateZ(0) scale(1.03); }
        100%{ box-shadow: 0 0 0 0 rgba(255,255,255,0.00), 0 0 0 0 rgba(120,210,255,0.00); transform: translateZ(0) scale(1); }
      }

      .aq-tutPulse{
        outline: 2px solid rgba(190, 240, 255, 0.55);
        outline-offset: 2px;
        animation: aqTutPulse 1.0s ease-in-out infinite;
      }
    `;
    document.head.appendChild(style);
  }

  _build() {
    const root = this._el("div");
    root.className = "aq-ui-root";

    const launcher = this._el("div");
    launcher.className = "aq-launcher";

    const shopBtn = this._btn("shop", "aq-btn aq-btnPill");
    shopBtn.setAttribute("data-aq-tut", "shop");
    shopBtn.addEventListener("click", () => {
      this.tab = "buy";
      this.buyCategory = "eggs";
      this.page = 0;
      this.setOpen(true);
      this._emit("click", { key: "shop_button" });
    });

    this._shopBtn = shopBtn;

    launcher.appendChild(shopBtn);
    root.appendChild(launcher);
    this._launcher = launcher;

    const overlay = this._el("div");
    overlay.className = "aq-overlay";
    overlay.addEventListener("click", () => this.setOpen(false));

    const panel = this._el("div");
    panel.className = "aq-panel";
    panel.addEventListener("click", (e) => e.stopPropagation());

    const top = this._el("div");
    top.className = "aq-top";

    const title = this._el("div");
    title.className = "aq-title";
    title.textContent = "shop";

    const topRight = this._el("div");
    topRight.className = "aq-topRight";

    const coinPill = this._el("div");
    coinPill.className = "aq-coinPill";

    const coinIcon = this._el("div");
    coinIcon.className = "aq-coinIcon";

    const coinText = this._el("div");
    coinText.className = "aq-coinText";
    coinText.textContent = `${this.state.coins}`;
    this._coinsText = coinText;

    coinPill.appendChild(coinIcon);
    coinPill.appendChild(coinText);

    const closeBtn = this._btn("close", "aq-btn aq-btnPill");
    closeBtn.setAttribute("data-aq-tut", "close");
    closeBtn.addEventListener("click", () => {
      this.setOpen(false);
      this._emit("click", { key: "shop_close" });
    });

    this._closeBtn = closeBtn;

    topRight.appendChild(coinPill);
    topRight.appendChild(closeBtn);

    top.appendChild(title);
    top.appendChild(topRight);

    const bar = this._el("div");
    bar.className = "aq-bar";

    const barLeft = this._el("div");
    barLeft.className = "aq-barLeft";

    const seg1 = this._el("div");
    seg1.className = "aq-seg";

    const buyBtn = this._btn("buy", "aq-btn aq-btnPill");
    const sellBtn = this._btn("sell", "aq-btn aq-btnPill");

    buyBtn.setAttribute("data-aq-tut", "tab_buy");
    sellBtn.setAttribute("data-aq-tut", "tab_sell");

    buyBtn.addEventListener("click", () => {
      this.tab = "buy";
      this.page = 0;
      this._sync();
      this._emit("tab", { tab: "buy" });
    });

    sellBtn.addEventListener("click", () => {
      this.tab = "sell";
      this.page = 0;
      this._sync();
      this._emit("tab", { tab: "sell" });
    });

    this._buyBtn = buyBtn;
    this._sellBtn = sellBtn;

    seg1.appendChild(buyBtn);
    seg1.appendChild(sellBtn);

    const seg2 = this._el("div");
    seg2.className = "aq-seg";

    const eggsBtn = this._btn("eggs", "aq-btn aq-btnPill");
    const decorBtn = this._btn("decor", "aq-btn aq-btnPill");

    eggsBtn.setAttribute("data-aq-tut", "cat_eggs");
    decorBtn.setAttribute("data-aq-tut", "cat_decor");

    eggsBtn.addEventListener("click", () => {
      this.buyCategory = "eggs";
      this.page = 0;
      this._sync();
      this._emit("click", { key: "cat_eggs" });
    });

    decorBtn.addEventListener("click", () => {
      this.buyCategory = "decor";
      this.page = 0;
      this._sync();
      this._emit("click", { key: "cat_decor" });
    });

    this._eggsBtn = eggsBtn;
    this._decorBtn = decorBtn;

    seg2.appendChild(eggsBtn);
    seg2.appendChild(decorBtn);

    barLeft.appendChild(seg1);
    barLeft.appendChild(seg2);

    const barRight = this._el("div");
    barRight.className = "aq-barRight";

    const prevBtn = this._btn("prev", "aq-btn aq-btnPill");
    prevBtn.addEventListener("click", () => {
      this.page = Math.max(0, this.page - 1);
      this._sync();
    });
    this._prevBtn = prevBtn;

    const pageText = this._el("div");
    pageText.className = "aq-pageText";
    pageText.textContent = "page 1 / 1";
    this._pageText = pageText;

    const nextBtn = this._btn("next", "aq-btn aq-btnPill");
    nextBtn.addEventListener("click", () => {
      this.page = this.page + 1;
      this._sync();
    });
    this._nextBtn = nextBtn;

    barRight.appendChild(prevBtn);
    barRight.appendChild(pageText);
    barRight.appendChild(nextBtn);

    bar.appendChild(barLeft);
    bar.appendChild(barRight);

    const gridWrap = this._el("div");
    gridWrap.className = "aq-gridWrap";

    const grid = this._el("div");
    grid.className = "aq-grid";
    this._grid = grid;

    gridWrap.appendChild(grid);

    panel.appendChild(top);
    panel.appendChild(bar);
    panel.appendChild(gridWrap);

    root.appendChild(overlay);
    root.appendChild(panel);

    this._root = root;
    this._overlay = overlay;
    this._panel = panel;

    this._disposableKeyHandler = (e) => {
      if (!this.open) return;
      if (e.key === "Escape") this.setOpen(false);
    };
    window.addEventListener("keydown", this._disposableKeyHandler);
  }

  _getActiveList() {
    if (this.tab === "sell") return this.data.sell || [];
    if (this.buyCategory === "decor") return this.data.decor || [];
    return this.data.eggs || [];
  }

  _syncAnchor() {
    if (!this._launcher) return;

    if (!this._anchorRect) {
      this._launcher.style.left = "";
      this._launcher.style.top = "14px";
      this._launcher.style.right = "16px";
      this._launcher.style.bottom = "";
      this._launcher.style.transform = "";
      return;
    }

    const inset = 14;
    const x = Math.round(this._anchorRect.right - inset);
    const y = Math.round(this._anchorRect.top + inset);

    this._launcher.style.position = "fixed";
    this._launcher.style.left = `${x}px`;
    this._launcher.style.top = `${y}px`;
    this._launcher.style.right = "";
    this._launcher.style.bottom = "";
    this._launcher.style.transform = "translateX(-100%)";
  }

  _sync() {
    if (!this._overlay || !this._panel || !this._grid) return;

    this._overlay.style.display = this.open ? "block" : "none";
    this._panel.style.display = this.open ? "grid" : "none";

    if (this._coinsText) this._coinsText.textContent = `${this.state.coins}`;

    if (this._buyBtn) this._buyBtn.classList.toggle("aq-active", this.tab === "buy");
    if (this._sellBtn) this._sellBtn.classList.toggle("aq-active", this.tab === "sell");

    const showSub = (this.tab === "buy");
    if (this._eggsBtn) this._eggsBtn.style.display = showSub ? "inline-block" : "none";
    if (this._decorBtn) this._decorBtn.style.display = showSub ? "inline-block" : "none";

    if (this._eggsBtn) this._eggsBtn.classList.toggle("aq-active", showSub && this.buyCategory === "eggs");
    if (this._decorBtn) this._decorBtn.classList.toggle("aq-active", showSub && this.buyCategory === "decor");

    const items = this._getActiveList();
    const perPage = 6;
    const pageCount = Math.max(1, Math.ceil(items.length / perPage));

    if (this.page > pageCount - 1) this.page = pageCount - 1;

    const pageStart = this.page * perPage;
    const pageEnd = Math.min(items.length, pageStart + perPage);
    const pageItems = items.slice(pageStart, pageEnd);

    if (this._pageText) this._pageText.textContent = `page ${this.page + 1} / ${pageCount}`;
    if (this._prevBtn) this._prevBtn.disabled = (this.page <= 0);
    if (this._nextBtn) this._nextBtn.disabled = (this.page >= pageCount - 1);

    // clear and rebuild grid contents
    this._grid.innerHTML = "";

    // sell tab: show only real items, no placeholders
    if (this.tab === "sell") {
      if (pageItems.length === 0) {
        const empty = this._el("div");
        empty.style.gridColumn = "1 / -1";
        empty.style.display = "grid";
        empty.style.placeItems = "center";
        empty.style.border = "1px dashed rgba(255,255,255,0.18)";
        empty.style.borderRadius = "20px";
        empty.style.background = "rgba(0,0,0,0.10)";
        empty.style.color = "rgba(238,247,255,0.75)";
        empty.style.fontWeight = "900";
        empty.style.letterSpacing = "0.3px";
        empty.style.height = "100%";
        empty.textContent = "no adult fish to sell";
        this._grid.appendChild(empty);
      } else {
        for (const it of pageItems) this._grid.appendChild(this._makeCard(it));
      }
      return;
    }

    // buy tab: keep your 6-slot layout with placeholders
    const filled = pageItems.length;
    const needed = perPage - filled;

    for (const it of pageItems) this._grid.appendChild(this._makeCard(it));
    for (let i = 0; i < needed; i++) this._grid.appendChild(this._makeCard(null));
  }

  _normaliseKey(v) {
    return String(v || "")
      .trim()
      .toLowerCase()
      .replace(/\s+/g, "")
      .replace(/[^a-z0-9_]/g, "");
  }

  _resolveSellThumbSrc(item) {
    if (!item) return "";

    // 1) direct path wins
    const direct = item.thumb || item.thumbUrl || item.thumbSrc;
    if (typeof direct === "string" && direct.trim()) return direct.trim();

    // 2) thumbKey is the intended mechanism for sell PNGs
    const key0 = this._normaliseKey(item.thumbKey);
    if (key0) return `assets/ui/fish/${key0}.png`;

    // 3) otherwise infer from name/type (NOT id/kind because sell ids are sell_7 etc)
    const key =
      this._normaliseKey(item.type) ||
      this._normaliseKey(item.name);

    if (!key) return "";

    const alias = {
      clownfish: "nemo",
      nemo: "nemo",
      bluetang: "dory",
      dory: "dory",
      carp: "carp",
      bass: "bass",
      anglerfish: "angler",
      angler: "angler",
      koi: "koi",
      octopus: "octo",
      octo: "octo",
      sardine: "sardine",
      sardines: "sardine"
    };

    const file = alias[key] || key;
    return `assets/ui/fish/${file}.png`;
  }

  _makeCard(item) {
    const card = this._el("div");
    card.className = "aq-card";

    const thumb = this._el("div");
    thumb.className = "aq-thumb";

    // SELL TAB THUMBS:
    // prefer caller-provided node (for prototype primitives),
    // otherwise fall back to PNG closeups
    if (item && this.tab === "sell") {
      if (this.getThumbNode) {
        const node = this.getThumbNode(item);
        if (node) {
          thumb.textContent = "";
          thumb.appendChild(node);
        } else {
          const src0 = this._resolveSellThumbSrc(item);
          if (src0) {
            const img0 = /** @type {HTMLImageElement} */ (document.createElement("img"));
            img0.className = "aq-thumbImg";
            img0.src = src0;
            img0.alt = (item && item.name) ? String(item.name) : "fish";
            img0.draggable = false;

            img0.addEventListener("error", () => {
              thumb.classList.remove("aq-thumbHasImg");
              thumb.innerHTML = "";
              thumb.textContent = "?";
            });

            thumb.classList.add("aq-thumbHasImg");
            thumb.textContent = "";
            thumb.appendChild(img0);
          } else {
            thumb.textContent = "?";
          }
        }
      } else {
        const src = this._resolveSellThumbSrc(item);

        if (src) {
          const img = /** @type {HTMLImageElement} */ (document.createElement("img"));
          img.className = "aq-thumbImg";
          img.src = src;
          img.alt = (item && item.name) ? String(item.name) : "fish";
          img.draggable = false;

          img.addEventListener("error", () => {
            thumb.classList.remove("aq-thumbHasImg");
            thumb.innerHTML = "";
            thumb.textContent = "?";
          });

          thumb.classList.add("aq-thumbHasImg");
          thumb.textContent = "";
          thumb.appendChild(img);
        } else {
          thumb.textContent = "?";
        }
      }
    } else if (item && this.getThumbNode) {
      const node = this.getThumbNode(item);
      if (node) {
        thumb.textContent = "";
        thumb.appendChild(node);
      } else {
        thumb.textContent = "?";
      }
    } else {
      thumb.textContent = item ? "?" : "soon tm";
    }

    const name = this._el("div");
    name.className = "aq-name";
    name.textContent = item ? (item.name || "mystery item") : "coming soon";

    const desc = this._el("div");
    desc.className = "aq-desc";
    desc.textContent = item ? (item.desc || "placeholder") : "stay tuned for future updates";

    const priceRow = this._el("div");
    priceRow.className = "aq-priceRow";

    const price = this._el("div");
    price.className = "aq-price";

    const coinIcon = this._el("div");
    coinIcon.className = "aq-coinIcon";
    coinIcon.style.width = "14px";
    coinIcon.style.height = "14px";

    const priceText = this._el("div");
    priceText.textContent = item ? `${item.price ?? 0}` : "-";

    price.appendChild(coinIcon);
    price.appendChild(priceText);

    const action = this._btn(this.tab === "sell" ? "sell" : "buy", "aq-btn aq-cardBtn");
    action.disabled = !item;

    // tutorial targets
    if (item) {
      if (this.tab === "sell") {
        // THIS is the second sell button you wanted: the one inside the first fish card
        // keyed by shop item id, like sell_item:sell_3
        if (item.id) action.setAttribute("data-aq-tut", `sell_item:${String(item.id)}`);
      } else if (item.id) {
        // eggs: buy_item:egg_basic, buy_item:egg_schooling, ...
        action.setAttribute("data-aq-tut", `buy_item:${String(item.id)}`);
      }
    }

    action.addEventListener("click", () => {
      if (!item) return;

      if (this.tab === "sell") {
        const gain = Math.max(0, item.price ?? 0);
        this.addCoins(gain);
        if (this.onSellItem) this.onSellItem(item);

        // emit with id so tutorial can match sell_${fishId}
        this._emit("sell", { id: String(item.id), item });

        action.textContent = "sold!";
        setTimeout(() => { action.textContent = "sell"; this._sync(); }, 600);
        return;
      }

      const cost = Math.max(0, item.price ?? 0);
      if (cost > this.state.coins) {
        action.textContent = "nope";
        setTimeout(() => { action.textContent = "buy"; }, 600);
        return;
      }

      this.addCoins(-cost);

      if (this.onBuyItem) this.onBuyItem(item);

      this._emit("buy", { id: String(item.id), item });

      action.textContent = "added!";
      setTimeout(() => { action.textContent = "buy"; }, 600);
    });

    priceRow.appendChild(price);
    priceRow.appendChild(action);

    card.appendChild(thumb);
    card.appendChild(name);
    card.appendChild(desc);
    card.appendChild(priceRow);

    return card;
  }
}
