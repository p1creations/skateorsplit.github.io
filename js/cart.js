(function () {
  const STORAGE_KEY = "sos_cart_v1";
  // PASTE YOUR FIREBASE FUNCTION URL HERE AFTER DEPLOYING PART 3:
  const CHECKOUT_FUNCTION_URL = "https://us-central1-garbagepathv2.cloudfunctions.net/createStripeCheckout";
  const FLAT_SHIPPING_PRICE = 6.00; // Displayed in cart preview ($6.00 flat rate)

  let cart = JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]");

  function saveCart() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(cart));
    renderCartUI();
    syncProductButtons();
  }

  // 1. Inject Slide-Out Cart Drawer & Styles
  function injectCartDOM() {
    const style = document.createElement("style");
    style.innerHTML = `
      #sos-cart-overlay {
        position: fixed; top: 0; left: 0; width: 100%; height: 100%;
        background: rgba(0,0,0,0.65); z-index: 9998; display: none;
      }
      #sos-cart-drawer {
        position: fixed; top: 0; right: -420px; width: 100%; max-width: 400px; height: 100%;
        background: #111; color: #fff; z-index: 9999; transition: right 0.25s ease;
        display: flex; flex-direction: column; box-shadow: -4px 0 20px rgba(0,0,0,0.5);
        font-family: inherit;
      }
      #sos-cart-drawer.open { right: 0; }
      .sos-cart-header {
        padding: 20px; border-bottom: 1px solid #2a2a2a;
        display: flex; justify-content: space-between; align-items: center;
      }
      .sos-cart-body { padding: 20px; overflow-y: auto; flex: 1; }
      .sos-cart-item {
        display: flex; align-items: center; justify-content: space-between;
        border-bottom: 1px solid #222; padding-bottom: 14px; margin-bottom: 14px;
      }
      .sos-cart-footer {
        padding: 20px; border-top: 1px solid #2a2a2a; background: #181818;
      }
      .sos-size-select {
        display: block; margin: 0 auto 12px auto; padding: 6px 12px;
        border: 1px solid #ccc; background: #fff; color: #111; font-weight: bold;
        width: 140px; border-radius: 0;
      }
      .sos-nav-cart-btn {
        background: #d9534f; color: #fff !important; padding: 8px 14px !important;
        margin-left: 10px; font-weight: bold; cursor: pointer; border-radius: 0;
      }
      .sos-nav-cart-btn:hover { background: #c9302c; }
    `;
    document.head.appendChild(style);

    // Add Cart Button to Navbar
    const navList = document.querySelector("#navbarResponsive .navbar-nav");
    if (navList) {
      const li = document.createElement("li");
      li.className = "nav-item";
      li.innerHTML = `<a class="nav-link sos-nav-cart-btn" id="sosOpenCartBtn">CART (<span id="sosCartCount">0</span>)</a>`;
      navList.appendChild(li);
      li.querySelector("#sosOpenCartBtn").addEventListener("click", (e) => {
        e.preventDefault();
        toggleCart(true);
      });
    }

    // Add Drawer HTML
    const wrapper = document.createElement("div");
    wrapper.innerHTML = `
      <div id="sos-cart-overlay"></div>
      <div id="sos-cart-drawer">
        <div class="sos-cart-header">
          <h4 style="margin: 0; text-transform: uppercase; font-weight: bold; letter-spacing: 1px;">Your Skate Bag</h4>
          <button id="sosCloseCartBtn" style="background:none; border:none; color:#fff; font-size:24px; cursor:pointer;">&times;</button>
        </div>
        <div class="sos-cart-body" id="sosCartItems"></div>
        <div class="sos-cart-footer">
          <div style="display:flex; justify-content:space-between; margin-bottom:6px; color:#aaa;">
            <span>Subtotal</span>
            <span id="sosCartSubtotal">$0.00</span>
          </div>
          <div style="display:flex; justify-content:space-between; margin-bottom:14px; color:#aaa; font-size:0.9em;">
            <span>Combined Flat Shipping</span>
            <span id="sosCartShipping">$${FLAT_SHIPPING_PRICE.toFixed(2)}</span>
          </div>
          <div style="font-size:0.78em; color:#888; margin-bottom:14px; line-height:1.4;">
            <strong>ALL SALES FINAL:</strong> No returns, refunds, or exchanges on limited DIY runs.
          </div>
          <button id="sosCheckoutBtn" class="btn btn-danger btn-lg btn-block font-weight-bold" style="border-radius:0; width:100%;">
            CHECKOUT WITH STRIPE
          </button>
        </div>
      </div>
    `;
    document.body.appendChild(wrapper);

    document.getElementById("sos-cart-overlay").addEventListener("click", () => toggleCart(false));
    document.getElementById("sosCloseCartBtn").addEventListener("click", () => toggleCart(false));
    document.getElementById("sosCheckoutBtn").addEventListener("click", handleStripeCheckout);
  }

  function toggleCart(open) {
    const drawer = document.getElementById("sos-cart-drawer");
    const overlay = document.getElementById("sos-cart-overlay");
    if (open) {
      overlay.style.display = "block";
      setTimeout(() => drawer.classList.add("open"), 10);
    } else {
      drawer.classList.remove("open");
      setTimeout(() => (overlay.style.display = "none"), 250);
    }
  }

  // 2. Automatically Wire Product Cards on shop.html & fingerboards.html
  function wireProductCards() {
    const isFingerboardPage = window.location.pathname.toLowerCase().includes("fingerboard");
    const buyButtons = document.querySelectorAll("#products a.btn-danger");

    buyButtons.forEach((btn, index) => {
      if (btn.textContent.trim().toUpperCase() !== "BUY NOW") return;

      const card = btn.closest(".col-lg-4, .col-lg-3, .col-md-6");
      if (!card) return;

      const titleEl = card.querySelector("h4");
      const paragraphs = Array.from(card.querySelectorAll("p"));
      const imgEl = card.querySelector("img");

      const baseTitle = titleEl ? titleEl.textContent.trim() : `SoS Item #${index + 1}`;
      let sizeText = "";
      let price = 20.0;

      paragraphs.forEach((p) => {
        const txt = p.textContent.trim();
        if (txt.toLowerCase().startsWith("size:")) {
          sizeText = txt.replace(/size:/i, "").trim();
        } else if (txt.includes("$")) {
          const parsed = parseFloat(txt.replace(/[^0-9.]/g, ""));
          if (!isNaN(parsed)) price = parsed;
        }
      });

      const imgSrc = imgEl ? new URL(imgEl.getAttribute("src"), window.location.href).href : "";

      // If on shop.html (Apparel), inject a T-Shirt Size dropdown (M, L, XL only)
      let sizeSelect = null;
      if (!isFingerboardPage) {
        sizeSelect = document.createElement("select");
        sizeSelect.className = "sos-size-select";
        ["M", "L", "XL"].forEach((sz) => {
          const opt = document.createElement("option");
          opt
