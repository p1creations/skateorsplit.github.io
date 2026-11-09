(function () {
  const STORAGE_KEY = "sos_cart_v1";
  const CHECKOUT_FUNCTION_URL = "https://us-central1-garbagepathv2.cloudfunctions.net/createStripeCheckout";

  let cart = JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]");

  function saveCart() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(cart));
    renderCartUI();
    syncProductButtons();
  }

  // Smart combined shipping calculation matching the backend function
  function calculateShipping(cartItems) {
    let shirtCount = 0;
    let boardCount = 0;

    cartItems.forEach(function (item) {
      if (item.isUnique) {
        boardCount += item.quantity;
      } else {
        shirtCount += item.quantity;
      }
    });

    if (shirtCount === 0 && boardCount === 0) return 0;

    // Fingerboards only: $2.50 base + $0.50 per additional board
    if (shirtCount === 0) {
      return 2.50 + Math.max(0, boardCount - 1) * 0.50;
    }

    // T-Shirts present: $5.00 base + $1.50 per additional shirt (boards ride free)
    return 5.00 + Math.max(0, shirtCount - 1) * 1.50;
  }

  function injectCartDOM() {
    const style = document.createElement("style");
    style.textContent = [
      "#sos-cart-overlay { position: fixed; top: 0; left: 0; width: 100%; height: 100%; background: rgba(0,0,0,0.65); z-index: 9998; display: none; }",
      "#sos-cart-drawer { position: fixed; top: 0; right: -420px; width: 100%; max-width: 400px; height: 100%; background: #111; color: #fff; z-index: 9999; transition: right 0.25s ease; display: flex; flex-direction: column; box-shadow: -4px 0 20px rgba(0,0,0,0.5); font-family: inherit; }",
      "#sos-cart-drawer.open { right: 0; }",
      ".sos-cart-header { padding: 20px; border-bottom: 1px solid #2a2a2a; display: flex; justify-content: space-between; align-items: center; }",
      ".sos-cart-body { padding: 20px; overflow-y: auto; flex: 1; }",
      ".sos-cart-item { display: flex; align-items: center; justify-content: space-between; border-bottom: 1px solid #222; padding-bottom: 14px; margin-bottom: 14px; }",
      ".sos-cart-footer { padding: 20px; border-top: 1px solid #2a2a2a; background: #181818; }",
      ".sos-size-select { display: block; margin: 0 auto 12px auto; padding: 6px 12px; border: 1px solid #ccc; background: #fff; color: #111; font-weight: bold; width: 140px; border-radius: 0; }",
      ".sos-nav-cart-btn { background: #d9534f; color: #fff !important; padding: 8px 14px !important; margin-left: 10px; font-weight: bold; cursor: pointer; border-radius: 0; }",
      ".sos-nav-cart-btn:hover { background: #c9302c; }"
    ].join("\n");
    document.head.appendChild(style);

    const navList = document.querySelector("#navbarResponsive .navbar-nav");
    if (navList) {
      const li = document.createElement("li");
      li.className = "nav-item";
      li.innerHTML = '<a class="nav-link sos-nav-cart-btn" id="sosOpenCartBtn">CART (<span id="sosCartCount">0</span>)</a>';
      navList.appendChild(li);
      li.querySelector("#sosOpenCartBtn").addEventListener("click", function (e) {
        e.preventDefault();
        toggleCart(true);
      });
    }

    const wrapper = document.createElement("div");
    wrapper.innerHTML =
      '<div id="sos-cart-overlay"></div>' +
      '<div id="sos-cart-drawer">' +
        '<div class="sos-cart-header">' +
          '<h4 style="margin: 0; text-transform: uppercase; font-weight: bold; letter-spacing: 1px;">Your Skate Bag</h4>' +
          '<button id="sosCloseCartBtn" style="background:none; border:none; color:#fff; font-size:24px; cursor:pointer;">&times;</button>' +
        '</div>' +
        '<div class="sos-cart-body" id="sosCartItems"></div>' +
        '<div class="sos-cart-footer">' +
          '<div style="display:flex; justify-content:space-between; margin-bottom:6px; color:#aaa;">' +
            '<span>Subtotal</span>' +
            '<span id="sosCartSubtotal">$0.00</span>' +
          '</div>' +
          '<div style="display:flex; justify-content:space-between; margin-bottom:14px; color:#aaa; font-size:0.9em;">' +
            '<span>Combined Shipping</span>' +
            '<span id="sosCartShipping">$0.00</span>' +
          '</div>' +
          '<div style="font-size:0.78em; color:#888; margin-bottom:14px; line-height:1.4;">' +
            '<strong>ALL SALES FINAL:</strong> No returns, refunds, or exchanges on limited DIY runs.' +
          '</div>' +
          '<button id="sosCheckoutBtn" class="btn btn-danger btn-lg btn-block font-weight-bold" style="border-radius:0; width:100%;">' +
            'CHECKOUT WITH STRIPE' +
          '</button>' +
        '</div>' +
      '</div>';
    document.body.appendChild(wrapper);

    document.getElementById("sos-cart-overlay").addEventListener("click", function () {
      toggleCart(false);
    });
    document.getElementById("sosCloseCartBtn").addEventListener("click", function () {
      toggleCart(false);
    });
    document.getElementById("sosCheckoutBtn").addEventListener("click", handleStripeCheckout);
  }

  function toggleCart(open) {
    const drawer = document.getElementById("sos-cart-drawer");
    const overlay = document.getElementById("sos-cart-overlay");
    if (open) {
      overlay.style.display = "block";
      setTimeout(function () {
        drawer.classList.add("open");
      }, 10);
    } else {
      drawer.classList.remove("open");
      setTimeout(function () {
        overlay.style.display = "none";
      }, 250);
    }
  }

  function wireProductCards() {
    const pageTitle = document.title.toLowerCase();
    const pageUrl = window.location.pathname.toLowerCase();
    
    // Only target merch/shop for sizes; testpage, fingerboards, index default to fingerboards (unique 1-of-1)
    const isMerchShopPage = pageUrl.includes("shop.html") || pageUrl.endsWith("/shop") || pageTitle.includes("merch");
    const buyButtons = document.querySelectorAll("#products a.btn-danger");

    buyButtons.forEach(function (btn, index) {
      if (btn.textContent.trim().toUpperCase() !== "BUY NOW") return;

      const card = btn.closest(".col-lg-4, .col-lg-3, .col-md-6");
      if (!card) return;

      const titleEl = card.querySelector("h4");
      const paragraphs = Array.from(card.querySelectorAll("p"));
      const imgEl = card.querySelector("img");

      const baseTitle = titleEl ? titleEl.textContent.trim() : "SoS Item #" + (index + 1);
      let price = 20.0;

      paragraphs.forEach(function (p) {
        const txt = p.textContent.trim();
        if (txt.includes("$")) {
          const parsed = parseFloat(txt.replace(/[^0-9.]/g, ""));
          if (!isNaN(parsed)) price = parsed;
        }
      });

      const imgSrc = imgEl ? new URL(imgEl.getAttribute("src"), window.location.href).href : "";

      let sizeSelect = null;
      // ONLY inject size dropdowns if we are strictly on the Merch/Shop page
      if (isMerchShopPage) {
        sizeSelect = document.createElement("select");
        sizeSelect.className = "sos-size-select";
        ["M", "L", "XL"].forEach(function (sz) {
          const opt = document.createElement("option");
          opt.value = sz;
          opt.textContent = "Size: " + sz;
          if (sz === "L") opt.selected = true;
          sizeSelect.appendChild(opt);
        });
        btn.parentNode.insertBefore(sizeSelect, btn);
      }

      btn.removeAttribute("href");
      btn.style.cursor = "pointer";
      btn.dataset.baseId = baseTitle.replace(/\s+/g, "-").toLowerCase();
      // If we are on testpage or fingerboards, isUnique is true (no size select)
      btn.dataset.isUnique = (!isMerchShopPage).toString();

      btn.addEventListener("click", function (e) {
        e.preventDefault();
        const selectedSize = sizeSelect ? sizeSelect.value : "";
        const itemId = sizeSelect
          ? btn.dataset.baseId + "-" + selectedSize
          : btn.dataset.baseId;

        const existing = cart.find(function (item) {
          return item.id === itemId;
        });

        if (!sizeSelect && existing) {
          toggleCart(true);
          return;
        }

        if (existing) {
          existing.quantity += 1;
        } else {
          cart.push({
            id: itemId,
            name: baseTitle,
            size: selectedSize,
            price: price,
            quantity: 1,
            isUnique: !isMerchShopPage,
            image: imgSrc
          });
        }

        saveCart();
        toggleCart(true);
      });
    });

    syncProductButtons();
  }

  function syncProductButtons() {
    const buyButtons = document.querySelectorAll("#products a[data-base-id]");
    buyButtons.forEach(function (btn) {
      const isUnique = btn.dataset.isUnique === "true";
      const inCart = cart.some(function (item) {
        return item.id === btn.dataset.baseId;
      });

      if (isUnique && inCart) {
        btn.textContent = "IN CART ✓";
        btn.classList.remove("btn-danger");
        btn.classList.add("btn-dark");
      } else {
        btn.textContent = "ADD TO CART";
        btn.classList.remove("btn-dark");
        btn.classList.add("btn-danger");
      }
    });
  }

  function renderCartUI() {
    const countEl = document.getElementById("sosCartCount");
    const listEl = document.getElementById("sosCartItems");
    const subtotalEl = document.getElementById("sosCartSubtotal");
    const shippingEl = document.getElementById("sosCartShipping");
    const checkoutBtn = document.getElementById("sosCheckoutBtn");

    if (!listEl) return;

    const totalCount = cart.reduce(function (sum, item) {
      return sum + item.quantity;
    }, 0);
    if (countEl) countEl.textContent = totalCount;

    if (cart.length === 0) {
      listEl.innerHTML = '<p class="text-muted text-center" style="margin-top:40px;">Your bag is empty.</p>';
      if (subtotalEl) subtotalEl.textContent = "$0.00";
      if (shippingEl) shippingEl.textContent = "$0.00";
      if (checkoutBtn) checkoutBtn.disabled = true;
      return;
    }

    if (checkoutBtn) checkoutBtn.disabled = false;
    let subtotal = 0;

    listEl.innerHTML = cart.map(function (item, idx) {
      const lineTotal = item.price * item.quantity;
      subtotal += lineTotal;
      const subLabel = item.size ? "Size: " + item.size : "Custom 5-Ply Deck";
      const qtyControls = item.isUnique
        ? '<span style="color:#888; font-size:0.85em;">1-of-1 Deck</span>'
        : '<div style="display:inline-flex; align-items:center; gap:8px; margin-top:4px;">' +
            '<button onclick="window.__sosUpdateQty(' + idx + ', -1)" style="background:#222; border:1px solid #444; color:#fff; width:24px; height:24px; line-height:1;">-</button>' +
            '<span>' + item.quantity + '</span>' +
            '<button onclick="window.__sosUpdateQty(' + idx + ', 1)" style="background:#222; border:1px solid #444; color:#fff; width:24px; height:24px; line-height:1;">+</button>' +
          '</div>';

      return (
        '<div class="sos-cart-item">' +
          '<div style="text-align:left; padding-right:10px;">' +
            '<div style="font-weight:bold; font-size:1em;">' + item.name + '</div>' +
            '<div style="color:#aaa; font-size:0.85em;">' + subLabel + ' &bull; $' + item.price.toFixed(2) + '</div>' +
            qtyControls +
          '</div>' +
          '<div style="text-align:right; white-space:nowrap;">' +
            '<div style="font-weight:bold; margin-bottom:6px;">$' + lineTotal.toFixed(2) + '</div>' +
            '<button onclick="window.__sosRemoveItem(' + idx + ')" style="background:none; border:none; color:#d9534f; font-size:0.8em; cursor:pointer; padding:0;">Remove</button>' +
          '</div>' +
        '</div>'
      );
    }).join("");

    if (subtotalEl) subtotalEl.textContent = "$" + subtotal.toFixed(2);
    if (shippingEl) shippingEl.textContent = "$" + calculateShipping(cart).toFixed(2);
  }

  window.__sosUpdateQty = function (idx, delta) {
    if (!cart[idx]) return;
    cart[idx].quantity += delta;
    if (cart[idx].quantity <= 0) cart.splice(idx, 1);
    saveCart();
  };

  window.__sosRemoveItem = function (idx) {
    cart.splice(idx, 1);
    saveCart();
  };

  async function handleStripeCheckout() {
    if (cart.length === 0) return;
    const btn = document.getElementById("sosCheckoutBtn");
    btn.disabled = true;
    btn.textContent = "REDIRECTING TO STRIPE...";

    try {
      const response = await fetch(CHECKOUT_FUNCTION_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          items: cart,
          returnUrl: window.location.origin + window.location.pathname
        })
      });

      const data = await response.json();
      if (!response.ok || !data.url) {
        throw new Error(data.error || "Failed to create checkout session");
      }

      window.location.href = data.url;
    } catch (err) {
      console.error("Stripe Checkout Error:", err);
      alert("Could not start checkout: " + err.message);
      btn.disabled = false;
      btn.textContent = "CHECKOUT WITH STRIPE";
    }
  }

  function checkUrlStatus() {
    const params = new URLSearchParams(window.location.search);
    if (params.get("checkout") === "success") {
      cart = [];
      saveCart();
      const container = document.querySelector("#products .container");
      if (container) {
        const alertBox = document.createElement("div");
        alertBox.style.cssText = "background:#28a745; color:#fff; padding:18px; margin-bottom:30px; font-weight:bold; font-size:1.1em;";
        alertBox.innerHTML = "ORDER CONFIRMED! Thank you for supporting SKATE or SPLIT. Your gear will ship out from Chicago soon.";
        container.prepend(alertBox);
      }
      window.history.replaceState({}, document.title, window.location.pathname);
    }
  }

  document.addEventListener("DOMContentLoaded", function () {
    injectCartDOM();
    wireProductCards();
    renderCartUI();
    checkUrlStatus();
  });
})();
