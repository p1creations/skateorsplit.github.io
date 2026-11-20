(function () {
  const STORAGE_KEY = "sos_cart_v1";
  const PROJECT_ID = "garbagepathv2";
  const CHECKOUT_FUNCTION_URL =
    "https://us-central1-" + PROJECT_ID + ".cloudfunctions.net/createStripeCheckout";
  const INVENTORY_FIRESTORE_URL =
    "https://firestore.googleapis.com/v1/projects/" +
    PROJECT_ID +
    "/databases/(default)/documents/sos_inventory?pageSize=200";

  let cart = JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]");
  // Map of itemId -> stock number (only contains items that exist in sos_inventory)
  let inventoryMap = new Map();

  function saveCart() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(cart));
    renderCartUI();
    syncProductButtons();
  }

  function getStockLimit(itemId, isUnique) {
    if (inventoryMap.has(itemId)) {
      return inventoryMap.get(itemId);
    }
    // Fingerboards default to 1; untracked shirts allow up to 10
    return isUnique ? 1 : 10;
  }

  async function loadInventory() {
    try {
      const res = await fetch(INVENTORY_FIRESTORE_URL);
      if (!res.ok) return;
      const data = await res.json();
      inventoryMap.clear();

      if (Array.isArray(data.documents)) {
        data.documents.forEach(function (doc) {
          const parts = doc.name.split("/");
          const docId = decodeURIComponent(parts[parts.length - 1]);
          const fields = doc.fields || {};
          const rawStock =
            fields.stock &&
            (fields.stock.integerValue !== undefined
              ? fields.stock.integerValue
              : fields.stock.doubleValue);
          const stock = Number(rawStock);
          if (docId && !isNaN(stock)) {
            inventoryMap.set(docId, Math.max(0, Math.floor(stock)));
          }
        });
      }

      // Trim or remove items in localStorage cart that exceed live stock
      let changed = false;
      cart = cart.filter(function (item) {
        const limit = getStockLimit(item.id, item.isUnique);
        if (limit <= 0) {
          changed = true;
          return false;
        }
        if (item.quantity > limit) {
          item.quantity = limit;
          changed = true;
        }
        return true;
      });
      if (changed) {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(cart));
      }

      syncProductButtons();
      renderCartUI();
    } catch (err) {
      console.warn("Could not load live inventory:", err);
    }
  }

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

    if (shirtCount === 0) {
      return 2.50 + Math.max(0, boardCount - 1) * 0.50;
    }

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
      ".sos-size-select { display: block; margin: 0 auto 12px auto; padding: 6px 12px; border: 1px solid #ccc; background: #fff; color: #111; font-weight: bold; width: 185px; border-radius: 0; }",
      ".sos-nav-cart-btn { background: #d9534f; color: #fff !important; padding: 8px 14px !important; margin-left: 10px; font-weight: bold; cursor: pointer; border-radius: 0; }",
      ".sos-nav-cart-btn:hover { background: #c9302c; }"
    ].join("\n");
    document.head.appendChild(style);

    const navList = document.querySelector("#navbarResponsive .navbar-nav");
    if (navList) {
      const li = document.createElement("li");
      li.className = "nav-item";
      li.innerHTML =
        '<a class="nav-link sos-nav-cart-btn" id="sosOpenCartBtn">CART (<span id="sosCartCount">0</span>)</a>';
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

    const isMerchShopPage = pageUrl.includes("shopii") || pageTitle.includes("merch");
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
      const baseId = baseTitle.replace(/\s+/g, "-").toLowerCase();

      let sizeSelect = null;
      if (isMerchShopPage) {
        sizeSelect = document.createElement("select");
        sizeSelect.className = "sos-size-select";
        sizeSelect.dataset.baseId = baseId;
        ["M", "L", "XL"].forEach(function (sz) {
          const opt = document.createElement("option");
          opt.value = sz;
          opt.textContent = "Size: " + sz;
          if (sz === "L") opt.selected = true;
          sizeSelect.appendChild(opt);
        });
        sizeSelect.addEventListener("change", syncProductButtons);
        btn.parentNode.insertBefore(sizeSelect, btn);
      }

      btn.removeAttribute("href");
      btn.style.cursor = "pointer";
      btn.dataset.baseId = baseId;
      btn.dataset.isUnique = (!isMerchShopPage).toString();

      btn.addEventListener("click", function (e) {
        e.preventDefault();
        const isUnique = btn.dataset.isUnique === "true";
        const selectedSize = sizeSelect ? sizeSelect.value : "";
        const itemId = sizeSelect ? baseId + "-" + selectedSize : baseId;
        const stockLimit = getStockLimit(itemId, isUnique);

        if (stockLimit <= 0) return;

        const existing = cart.find(function (item) {
          return item.id === itemId;
        });

        if (isUnique && existing) {
          toggleCart(true);
          return;
        }

        if (existing) {
          if (existing.quantity < stockLimit) {
            existing.quantity += 1;
          } else {
            alert("Only " + stockLimit + " left in stock for this item.");
          }
        } else {
          cart.push({
            id: itemId,
            name: baseTitle,
            size: selectedSize,
            price: price,
            quantity: 1,
            isUnique: isUnique,
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
    // Update size dropdown labels with live stock counts
    const selects = document.querySelectorAll("#products select.sos-size-select");
    selects.forEach(function (sel) {
      const baseId = sel.dataset.baseId;
      Array.from(sel.options).forEach(function (opt) {
        const sz = opt.value;
        const itemId = baseId + "-" + sz;
        if (inventoryMap.has(itemId)) {
          const stock = inventoryMap.get(itemId);
          opt.textContent =
            stock <= 0 ? "Size: " + sz + " (SOLD OUT)" : "Size: " + sz + " (" + stock + " left)";
        } else {
          opt.textContent = "Size: " + sz;
        }
      });
    });

    // Update ADD TO CART / IN CART / SOLD OUT buttons
    const buyButtons = document.querySelectorAll("#products a[data-base-id]");
    buyButtons.forEach(function (btn) {
      const isUnique = btn.dataset.isUnique === "true";
      const baseId = btn.dataset.baseId;
      const card = btn.closest(".col-lg-4, .col-lg-3, .col-md-6");
      const sizeSelect = card ? card.querySelector("select.sos-size-select") : null;
      const activeId = sizeSelect ? baseId + "-" + sizeSelect.value : baseId;

      const stockLimit = getStockLimit(activeId, isUnique);
      const inCart = cart.some(function (item) {
        return item.id === activeId;
      });

      if (stockLimit <= 0) {
        btn.textContent = "SOLD OUT";
        btn.classList.remove("btn-danger", "btn-dark");
        btn.classList.add("btn-secondary", "disabled");
        btn.style.cursor = "not-allowed";
        btn.style.opacity = "0.65";
      } else if (isUnique && inCart) {
        btn.textContent = "IN CART ✓";
        btn.classList.remove("btn-danger", "btn-secondary", "disabled");
        btn.classList.add("btn-dark");
        btn.style.cursor = "pointer";
        btn.style.opacity = "1";
      } else {
        btn.textContent = "ADD TO CART";
        btn.classList.remove("btn-dark", "btn-secondary", "disabled");
        btn.classList.add("btn-danger");
        btn.style.cursor = "pointer";
        btn.style.opacity = "1";
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
      const stockLimit = getStockLimit(item.id, item.isUnique);
      const atMax = item.quantity >= stockLimit;

      const qtyControls = item.isUnique
        ? '<span style="color:#888; font-size:0.85em;">1-of-1 Deck</span>'
        : '<div style="display:inline-flex; align-items:center; gap:8px; margin-top:4px;">' +
            '<button onclick="window.__sosUpdateQty(' + idx + ', -1)" style="background:#222; border:1px solid #444; color:#fff; width:24px; height:24px; line-height:1;">-</button>' +
            '<span>' + item.quantity + '</span>' +
            '<button onclick="window.__sosUpdateQty(' + idx + ', 1)" ' +
              (atMax ? 'disabled style="background:#222; border:1px solid #333; color:#555; width:24px; height:24px; line-height:1; cursor:not-allowed;"' : 'style="background:#222; border:1px solid #444; color:#fff; width:24px; height:24px; line-height:1;"') +
            '>+</button>' +
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
    const item = cart[idx];
    const limit = getStockLimit(item.id, item.isUnique);
    const nextQty = item.quantity + delta;
    if (nextQty <= 0) {
      cart.splice(idx, 1);
    } else if (nextQty <= limit) {
      item.quantity = nextQty;
    }
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
      loadInventory();
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
    loadInventory();
  });
})();
