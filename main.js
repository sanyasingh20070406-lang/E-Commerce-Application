// Cart management
const configuredBackendUrl = (window.__BACKEND_URL__ || '').replace(/\/$/, '');
const isLocalHost = ['localhost', '127.0.0.1'].includes(window.location.hostname);
const API_BASE_URL = configuredBackendUrl || (isLocalHost ? 'http://127.0.0.1:8000' : '');
const USE_LOCAL_BACKEND = false;
let cartItems = JSON.parse(localStorage.getItem('cartItems')) || [];
let totalCartCount = cartItems.reduce((sum, item) => sum + item.quantity, 0);
let currentUser = JSON.parse(localStorage.getItem('currentUser')) || null;
let authToken = localStorage.getItem('authToken') || '';
const LAST_AUTH_EMAIL_KEY = 'lastAuthEmail';

function isUserLoggedIn() {
    return !!currentUser && !!authToken;
}

function rememberAuthEmail(email) {
    if (email) {
        localStorage.setItem(LAST_AUTH_EMAIL_KEY, email);
    }
}

function prefillKnownEmail(target = 'both') {
    const savedEmail = currentUser?.email || localStorage.getItem(LAST_AUTH_EMAIL_KEY) || '';
    if (!savedEmail) return;

    const loginEmail = document.getElementById("login-email");
    const signupEmail = document.getElementById("user-email");

    if ((target === 'both' || target === 'login') && loginEmail && !loginEmail.value) {
        loginEmail.value = savedEmail;
    }

    if ((target === 'both' || target === 'signup') && signupEmail && !signupEmail.value) {
        signupEmail.value = savedEmail;
    }
}

function setSession(data) {
    authToken = data.token;
    currentUser = data.user;
    localStorage.setItem('authToken', authToken);
    localStorage.setItem('currentUser', JSON.stringify(currentUser));
    rememberAuthEmail(currentUser.email);
}

function clearSession() {
    authToken = '';
    currentUser = null;
    cartItems = [];
    totalCartCount = 0;
    localStorage.removeItem('authToken');
    localStorage.removeItem('currentUser');
    localStorage.removeItem('cartItems');
}

function getLocalData(key, defaultValue) {
    try {
        return JSON.parse(localStorage.getItem(key) || JSON.stringify(defaultValue));
    } catch {
        return defaultValue;
    }
}

function setLocalData(key, value) {
    localStorage.setItem(key, JSON.stringify(value));
}

function getLocalUsers() {
    return getLocalData('local_users', []);
}

function saveLocalUsers(users) {
    setLocalData('local_users', users);
}

function findLocalUser(email) {
    return getLocalUsers().find(user => user.email.toLowerCase() === email.toLowerCase());
}

function getLocalCartItems(email) {
    const carts = getLocalData('local_carts', {});
    return carts[email.toLowerCase()] || [];
}

function saveLocalCartItems(email, items) {
    const carts = getLocalData('local_carts', {});
    carts[email.toLowerCase()] = items;
    setLocalData('local_carts', carts);
}

function getLocalAddresses(email) {
    const addresses = getLocalData('local_addresses', {});
    return addresses[email.toLowerCase()] || [];
}

function saveLocalAddresses(email, items) {
    const addresses = getLocalData('local_addresses', {});
    addresses[email.toLowerCase()] = items;
    setLocalData('local_addresses', addresses);
}

function getLocalWishlist(email) {
    const wishlist = getLocalData('local_wishlist', {});
    return wishlist[email.toLowerCase()] || [];
}

function saveLocalWishlist(email, items) {
    const wishlist = getLocalData('local_wishlist', {});
    wishlist[email.toLowerCase()] = items;
    setLocalData('local_wishlist', wishlist);
}

async function apiRequest(path, options = {}) {
    if (USE_LOCAL_BACKEND && path.startsWith('/api/')) {
        return handleLocalApiRequest(path, options);
    }

    const headers = {
        'Content-Type': 'application/json',
        ...(options.headers || {})
    };

    if (authToken) {
        headers.Authorization = `Bearer ${authToken}`;
    }

    if (!API_BASE_URL) {
        throw new Error('Backend URL is not configured. Set window.__BACKEND_URL__ to your Render API URL.');
    }

    let response;
    try {
        response = await fetch(`${API_BASE_URL}${path}`, {
            ...options,
            headers
        });
    } catch (error) {
        if (error instanceof TypeError) {
            throw new Error(`Cannot connect to FastAPI at ${API_BASE_URL}. Start the backend server and try again.`);
        }
        throw error;
    }

    let data = {};
    try {
        data = await response.json();
    } catch (error) {
        data = {};
    }

    if (!response.ok) {
        if (response.status === 401) {
            clearSession();
            updateUserProfile();
        }
        let errorMsg = 'Request failed';
        if (typeof data.detail === 'string') {
            errorMsg = data.detail;
        } else if (Array.isArray(data.detail)) {
            errorMsg = data.detail.map(e => `${e.loc ? e.loc[e.loc.length-1] + ': ' : ''}${e.msg}`).join(', ');
        } else if (data.detail) {
            errorMsg = JSON.stringify(data.detail);
        }
        throw new Error(errorMsg);
    }

    return data;
}

function handleLocalApiRequest(path, options = {}) {
    const method = (options.method || 'GET').toUpperCase();
    const body = options.body ? JSON.parse(options.body) : null;
    const email = currentUser?.email?.toLowerCase();

    if (path === '/api/auth/register' && method === 'POST') {
        const { name, email: registerEmail, password } = body;
        if (!name || !registerEmail || !password) {
            throw new Error('Name, email, and password are required');
        }
        if (findLocalUser(registerEmail)) {
            throw new Error('Email already registered');
        }
        const users = getLocalUsers();
        const newUser = {
            id: Date.now(),
            name: name.trim(),
            email: registerEmail.toLowerCase(),
            password: password
        };
        users.push(newUser);
        saveLocalUsers(users);
        const token = `local-${newUser.id}-${Date.now()}`;
        return { token, user: { id: newUser.id, name: newUser.name, email: newUser.email } };
    }

    if (path === '/api/auth/login' && method === 'POST') {
        const { email: loginEmail, password } = body;
        const user = findLocalUser(loginEmail);
        if (!user || user.password !== password) {
            throw new Error('Invalid email or password');
        }
        const token = `local-${user.id}-${Date.now()}`;
        return { token, user: { id: user.id, name: user.name, email: user.email } };
    }

    if (!email) {
        throw new Error('Unauthorized: please sign in first');
    }

    if (path === '/api/cart' && method === 'GET') {
        return { items: getLocalCartItems(email) };
    }

    if (path === '/api/cart' && method === 'POST') {
        const items = getLocalCartItems(email);
        const existing = items.find(item => item.product_id === body.product_id);
        if (existing) {
            existing.quantity = Math.min(existing.quantity + body.quantity, 10);
            existing.name = body.name;
            existing.price = body.price;
        } else {
            items.push({
                product_id: body.product_id,
                name: body.name,
                price: body.price,
                quantity: body.quantity
            });
        }
        saveLocalCartItems(email, items);
        return { success: true };
    }

    const cartMatch = path.match(/^\/api\/cart\/(\d+)$/);
    if (cartMatch) {
        const productId = parseInt(cartMatch[1], 10);
        const items = getLocalCartItems(email);
        const idx = items.findIndex(item => item.product_id === productId);
        if (method === 'PUT') {
            const quantity = body.quantity;
            if (idx === -1) {
                throw new Error('Cart item not found');
            }
            if (quantity <= 0) {
                items.splice(idx, 1);
            } else {
                items[idx].quantity = quantity;
            }
            saveLocalCartItems(email, items);
            return { success: true };
        }
        if (method === 'DELETE') {
            if (idx !== -1) {
                items.splice(idx, 1);
                saveLocalCartItems(email, items);
            }
            return { success: true };
        }
    }

    if (path === '/api/addresses' && method === 'GET') {
        return { addresses: getLocalAddresses(email) };
    }

    if (path === '/api/addresses' && method === 'POST') {
        const items = getLocalAddresses(email);
        const newAddress = {
            id: Date.now(),
            ...body
        };
        items.push(newAddress);
        saveLocalAddresses(email, items);
        return { success: true };
    }

    const addressMatch = path.match(/^\/api\/addresses\/(\d+)$/);
    if (addressMatch && method === 'DELETE') {
        const id = parseInt(addressMatch[1], 10);
        let items = getLocalAddresses(email);
        items = items.filter(addr => addr.id !== id);
        saveLocalAddresses(email, items);
        return { success: true };
    }

    if (path === '/api/wishlist' && method === 'GET') {
        return { items: getLocalWishlist(email) };
    }

    if (path === '/api/wishlist' && method === 'POST') {
        const items = getLocalWishlist(email);
        if (!items.includes(body.product_id)) {
            items.push(body.product_id);
            saveLocalWishlist(email, items);
        }
        return { success: true };
    }

    const wishlistMatch = path.match(/^\/api\/wishlist\/(\d+)$/);
    if (wishlistMatch && method === 'DELETE') {
        const productId = parseInt(wishlistMatch[1], 10);
        let items = getLocalWishlist(email);
        items = items.filter(id => id !== productId);
        saveLocalWishlist(email, items);
        return { success: true };
    }

    if (path === '/api/orders' && method === 'GET') {
        return { orders: [] };
    }

    if (path === '/api/checkout/create-session' && method === 'POST') {
        saveLocalCartItems(email, []);
        cartItems = [];
        totalCartCount = 0;
        saveCartToLocal();
        return { checkout_url: 'success.html' };
    }

    throw new Error(`Unknown API route: ${path}`);
}

async function registerUser(name, email, password) {
    const data = await apiRequest('/api/auth/register', {
        method: 'POST',
        body: JSON.stringify({ name, email, password })
    });
    setSession(data);
    return data;
}

async function loginUser(email, password) {
    const data = await apiRequest('/api/auth/login', {
        method: 'POST',
        body: JSON.stringify({ email, password })
    });
    setSession(data);
    return data;
}

function logoutUser() {
    clearSession();
    updateTotalCartCount();
    syncProductQtyUI();
    renderCartModal();
}

// Show signup modal
function showSignupModal() {
    if (isUserLoggedIn()) {
        alert(`You are already signed in as ${currentUser.email}.`);
        return;
    }

    document.getElementById("signup-modal").classList.add("show");
    document.getElementById("login-modal").classList.remove("show");
    resetSignupOtpState();
    prefillKnownEmail('signup');
}

// Show login modal
function showLoginModal() {
    document.getElementById("login-modal").classList.add("show");
    document.getElementById("signup-modal").classList.remove("show");
    resetSignupOtpState();
    prefillKnownEmail('login');
}

// Hide signup/login modals
function hideAuthModals() {
    document.getElementById("signup-modal").classList.remove("show");
    document.getElementById("login-modal").classList.remove("show");
    resetSignupOtpState();
}

function resetSignupOtpState() {
    // No OTP state needed for normal registration flow.
}

// Handle signup form submission
document.getElementById("signup-form").addEventListener("submit", async (e) => {
    e.preventDefault();

    const name = document.getElementById("user-name").value.trim();
    const email = document.getElementById("user-email").value.trim();
    const password = document.getElementById("user-password").value.trim();

    if (!name || !email || !password) {
        alert("Please fill in all fields");
        return;
    }

    try {
        const data = await registerUser(name, email, password);
        console.log('Signup successful, currentUser:', currentUser);
        document.getElementById("signup-form").reset();
        hideAuthModals();
        updateUserProfile();
        await loadCartFromServer();
        // Reinitialize cart controls after signup
        initializeProductCartControls();
        alert(`Welcome ${name}! Your account has been created. Please add your delivery location.`);
        if (profileSection) {
            await openProfileSection("account");
            showAddressForm();
        } else {
            window.location.href = "index.html?account=account&addAddress=1";
        }
    } catch (error) {
        if (error.message.toLowerCase().includes("email already registered")) {
            rememberAuthEmail(email);
            document.getElementById("login-email").value = email;
            document.getElementById("login-password").value = password;
            showLoginModal();
            alert("This email already has an account. I filled the login form so you can sign in directly.");
            return;
        }
        alert(error.message);
    }
});

// --- Profile & Wishlist Logic ---

const navProfile = document.getElementById("nav-profile");
const profileSection = document.getElementById("profile-section");
const navWishlist = document.getElementById("nav-wishlist");
const wishlistSection = document.getElementById("wishlist-section");

function showAccountTab(tabName = "account") {
    document.querySelectorAll(".account-tab").forEach(tab => {
        tab.classList.toggle("active", tab.dataset.accountTab === tabName);
    });
    document.querySelectorAll(".account-panel").forEach(panel => {
        panel.classList.toggle("active", panel.dataset.accountPanel === tabName);
    });
}

function showAddressForm() {
    const formContainer = document.getElementById("address-form-container");
    const addBtn = document.getElementById("add-address-btn");
    const firstAddressInput = document.getElementById("addr-name");

    if (formContainer) formContainer.style.display = "block";
    if (addBtn) addBtn.style.display = "none";
    if (firstAddressInput) firstAddressInput.focus();
}

async function openProfileSection(tabName = "account") {
    if (!isUserLoggedIn()) {
        showLoginModal();
        return;
    }

    if (!profileSection) {
        window.location.href = `index.html?account=${encodeURIComponent(tabName)}`;
        return;
    }

    document.querySelectorAll("section").forEach(s => {
        if (s.id !== "header") s.style.display = "none";
    });
    profileSection.style.display = "block";
    document.getElementById("profile-name").innerText = currentUser.name;
    document.getElementById("profile-email").innerText = currentUser.email;
    const accountEmail = document.getElementById("account-email");
    if (accountEmail) accountEmail.innerText = currentUser.email;
    showAccountTab(tabName);
    await loadAddresses();
    await loadOrders();
    profileSection.scrollIntoView({ behavior: "smooth", block: "start" });
}

if (navProfile) {
    navProfile.addEventListener("click", async (e) => {
        e.preventDefault();
        await openProfileSection("account");
    });
}

document.querySelectorAll(".account-tab").forEach(tab => {
    tab.addEventListener("click", async () => {
        const tabName = tab.dataset.accountTab || "account";
        showAccountTab(tabName);
        if (tabName === "orders") await loadOrders();
    });
});

const accountLogoutBtn = document.getElementById("account-logout-btn");
if (accountLogoutBtn) {
    accountLogoutBtn.addEventListener("click", () => {
        logoutUser();
        updateUserProfile();
        window.location.href = "index.html";
    });
}

const refundHelpBtn = document.getElementById("refund-help-btn");
if (refundHelpBtn) {
    refundHelpBtn.addEventListener("click", () => {
        showAccountTab("help");
    });
}

if (navWishlist) {
    navWishlist.addEventListener("click", async (e) => {
        e.preventDefault();
        document.querySelectorAll("section").forEach(s => {
            if (s.id !== "header") s.style.display = "none";
        });
        wishlistSection.style.display = "block";
        await renderWishlistPage();
    });
}

// Addresses
let addresses = [];

async function loadAddresses() {
    if (!isUserLoggedIn()) return;
    try {
        const data = await apiRequest('/api/addresses');
        addresses = data.addresses || [];
        renderAddresses();
        updateCheckoutAddressSelect();
    } catch (error) {
        console.error("Error loading addresses:", error);
    }
}

function renderAddresses() {
    const addressList = document.getElementById("address-list");
    if (!addressList) return;
    
    addressList.innerHTML = "";
    if (addresses.length === 0) {
        addressList.innerHTML = "<p>No addresses found.</p>";
        return;
    }
    
    addresses.forEach(addr => {
        const div = document.createElement("div");
        div.style.cssText = "padding: 15px; border: 1px solid #ddd; margin-bottom: 10px; border-radius: 5px;";
        div.innerHTML = `
            <strong>${addr.name}</strong> ${addr.is_default ? '<span style="color:red; font-size:12px;">(Default)</span>' : ''}<br>
            ${addr.street}, ${addr.city}, ${addr.state} ${addr.zip}<br>
            ${addr.country}<br>
            <button onclick="deleteAddress(${addr.id})" style="margin-top:10px; background:none; border:none; color:red; cursor:pointer;">Delete</button>
        `;
        addressList.appendChild(div);
    });
}

async function deleteAddress(id) {
    if (!confirm("Delete this address?")) return;
    try {
        await apiRequest(`/api/addresses/${id}`, { method: 'DELETE' });
        await loadAddresses();
    } catch (e) {
        alert(e.message);
    }
}

function updateCheckoutAddressSelect() {
    const select = document.getElementById("checkout-address-select");
    const section = document.getElementById("checkout-address-section");
    if (!select || !section) return;
    
    if (addresses.length === 0) {
        section.style.display = "none";
        return;
    }
    
    section.style.display = "block";
    select.innerHTML = "";
    addresses.forEach(addr => {
        const option = document.createElement("option");
        option.value = addr.id;
        option.text = `${addr.name} - ${addr.street}, ${addr.city}`;
        if (addr.is_default) option.selected = true;
        select.appendChild(option);
    });
}

const addAddressBtn = document.getElementById("add-address-btn");
const addressFormContainer = document.getElementById("address-form-container");
const cancelAddressBtn = document.getElementById("cancel-address-btn");
const addressForm = document.getElementById("address-form");

if (addAddressBtn) {
    addAddressBtn.addEventListener("click", () => {
        showAddressForm();
    });
}

if (cancelAddressBtn) {
    cancelAddressBtn.addEventListener("click", () => {
        addressFormContainer.style.display = "none";
        addAddressBtn.style.display = "inline-block";
        addressForm.reset();
    });
}

if (addressForm) {
    addressForm.addEventListener("submit", async (e) => {
        e.preventDefault();
        const payload = {
            name: document.getElementById("addr-name").value,
            street: document.getElementById("addr-street").value,
            city: document.getElementById("addr-city").value,
            state: document.getElementById("addr-state").value,
            zip: document.getElementById("addr-zip").value,
            country: document.getElementById("addr-country").value,
            is_default: document.getElementById("addr-default").checked
        };
        
        try {
            await apiRequest('/api/addresses', {
                method: 'POST',
                body: JSON.stringify(payload)
            });
            addressForm.reset();
            addressFormContainer.style.display = "none";
            addAddressBtn.style.display = "inline-block";
            await loadAddresses();
        } catch (error) {
            alert(error.message);
        }
    });
}

// Wishlist
let wishlist = [];

async function loadWishlist() {
    if (!isUserLoggedIn()) return;
    try {
        const data = await apiRequest('/api/wishlist');
        wishlist = data.items || [];
        updateHeartIcons();
    } catch (e) {
        console.error(e);
    }
}

async function toggleWishlist(productId, btn) {
    if (!isUserLoggedIn()) {
        showSignupModal();
        return;
    }
    const inWishlist = wishlist.includes(productId);
    try {
        if (inWishlist) {
            await apiRequest(`/api/wishlist/${productId}`, { method: 'DELETE' });
            wishlist = wishlist.filter(id => id !== productId);
            btn.style.color = "#ccc";
        } else {
            await apiRequest('/api/wishlist', {
                method: 'POST',
                body: JSON.stringify({ product_id: productId })
            });
            wishlist.push(productId);
            btn.style.color = "red";
        }
    } catch (e) {
        alert(e.message);
    }
}

function updateHeartIcons() {
    document.querySelectorAll(".wishlist-btn").forEach(btn => {
        const id = parseInt(btn.getAttribute("data-product-id"));
        if (wishlist.includes(id)) {
            btn.style.color = "red";
        } else {
            btn.style.color = "#ccc";
        }
    });
}

async function renderWishlistPage() {
    const container = document.getElementById("wishlist-container");
    if (!container) return;
    
    if (wishlist.length === 0) {
        container.innerHTML = "<p>Your wishlist is empty.</p>";
        return;
    }
    
    container.innerHTML = "";
    document.querySelectorAll(".pro:not(#wishlist-container .pro)").forEach(pro => {
        const id = parseInt(pro.getAttribute("data-product-id"));
        if (wishlist.includes(id)) {
            const clone = pro.cloneNode(true);
            container.appendChild(clone);
        }
    });
    // Reinitialize controls on the clones so users can add to cart from wishlist
    initializeProductCartControls();
    updateHeartIcons();
}

// Orders
async function loadOrders() {
    const container = document.getElementById("order-history");
    if (!container) return;
    try {
        const data = await apiRequest('/api/orders');
        const orders = data.orders || [];
        if (orders.length === 0) {
            container.innerHTML = "<p>No orders yet.</p>";
            return;
        }
        container.innerHTML = orders.map(o => `
            <div style="padding: 10px; border: 1px solid #ddd; margin-bottom: 10px; border-radius: 5px;">
                <strong>Order #${o.id}</strong> - $${formatPrice(o.total_amount)}
                <br>Status: <span style="color:${o.payment_status==='paid'?'green': (o.payment_status==='pending'?'orange':'red')}">${o.payment_status}</span>
                <br>Payment: ${(o.payment_method || 'cod').toUpperCase()}
                <br>Date: ${new Date(o.created_at).toLocaleString()}
            </div>
        `).join("");
    } catch(e) {
        console.error(e);
    }
}

// Handle login form submission
document.getElementById("login-form").addEventListener("submit", async (e) => {
    e.preventDefault();

    const email = document.getElementById("login-email").value.trim();
    const password = document.getElementById("login-password").value.trim();

    if (!email || !password) {
        alert("Please fill in all fields");
        return;
    }

    try {
        const data = await loginUser(email, password);
        console.log('Login successful, currentUser:', currentUser);
        rememberAuthEmail(email);
        document.getElementById("login-form").reset();
        hideAuthModals();
        updateUserProfile();
        await loadCartFromServer();
        // Reinitialize cart controls after login
        initializeProductCartControls();
        alert(`Welcome back ${data.user.name}!`);
    } catch (error) {
        alert(error.message);
    }
});

// Google Sign in (simulated)
const googleSigninBtn = document.getElementById("google-signin-btn");
if (googleSigninBtn) {
    googleSigninBtn.addEventListener("click", async () => {
        alert("Google OAuth is not connected yet. Use email OTP signup for now.");
    });
}

// Google Login (simulated)
const googleLoginBtn = document.getElementById("google-login-btn");
if (googleLoginBtn) {
    googleLoginBtn.addEventListener("click", async () => {
        alert("Google OAuth is not connected yet. Use normal email login for now.");
    });
}

// Toggle between signup and login forms
document.getElementById("login-link").addEventListener("click", (e) => {
    e.preventDefault();
    showLoginModal();
});

document.getElementById("signup-link").addEventListener("click", (e) => {
    e.preventDefault();
    showSignupModal();
});

// Close signup/login modals
document.getElementById("signup-close").addEventListener("click", hideAuthModals);
document.getElementById("login-close").addEventListener("click", hideAuthModals);

// Close modals when clicking outside
window.addEventListener("click", (e) => {
    const signupModal = document.getElementById("signup-modal");
    const loginModal = document.getElementById("login-modal");

    if (e.target === signupModal) signupModal.classList.remove("show");
    if (e.target === loginModal) loginModal.classList.remove("show");
});

// Cart management
let productControlsInitialized = false;

function formatPrice(value) {
    return value.toFixed(2);
}

function getQtyValue(qtyElem) {
    if (!qtyElem) return 0;
    const rawValue = qtyElem.matches('input, textarea, select') ? qtyElem.value : qtyElem.innerText;
    const quantity = parseInt(rawValue, 10);
    return Number.isNaN(quantity) ? 0 : quantity;
}

function setQtyValue(qtyElem, quantity) {
    if (!qtyElem) return;
    if (qtyElem.matches('input, textarea, select')) {
        qtyElem.value = quantity;
    } else {
        qtyElem.innerText = quantity;
    }
}

function saveCartToLocal() {
    localStorage.setItem('cartItems', JSON.stringify(cartItems));
}

async function loadCartFromServer() {
    if (!isUserLoggedIn()) {
        cartItems = [];
        totalCartCount = 0;
        saveCartToLocal();
        updateTotalCartCount();
        syncProductQtyUI();
        renderCartModal();
        return;
    }

    const data = await apiRequest('/api/cart');
    cartItems = data.items || [];
    saveCartToLocal();
    totalCartCount = cartItems.reduce((sum, item) => sum + item.quantity, 0);
    updateTotalCartCount();
    syncProductQtyUI();
    renderCartModal();
}

function syncProductQtyUI() {
    const products = document.querySelectorAll('.pro');
    products.forEach((product, index) => {
        const productId = parseInt(product.getAttribute('data-product-id'), 10) || index + 1;
        const cartItem = cartItems.find(item => item.product_id === productId);
        const qtyElem = product.querySelector('.item-qty');
        const minusBtn = product.querySelector('.cart-btn.minus');

        const qty = cartItem ? cartItem.quantity : 0;
        setQtyValue(qtyElem, qty);
        if (minusBtn) minusBtn.disabled = qty <= 0;
    });
}

async function addToCart(productId, quantity = 1) {
    if (!isUserLoggedIn()) {
        throw new Error('Please sign in to add items to your cart.');
    }

    const productEl = document.querySelector(`.pro[data-product-id="${productId}"]`);
    let name = "Product";
    let price = 0;

    if (productEl) {
        const nameEl = productEl.querySelector("h5");
        const priceEl = productEl.querySelector("h4");
        if (nameEl) name = nameEl.innerText;
        if (priceEl) price = parseFloat(priceEl.innerText.replace(/[^0-9.]/g, ''));
    }

    await apiRequest('/api/cart', {
        method: 'POST',
        body: JSON.stringify({ product_id: productId, name, price, quantity })
    });
    await loadCartFromServer();
}

async function updateCartItem(productId, quantity) {
    if (!isUserLoggedIn()) {
        return;
    }

    if (quantity <= 0) {
        await apiRequest(`/api/cart/${productId}`, {
            method: 'DELETE'
        });
    } else {
        await apiRequest(`/api/cart/${productId}`, {
            method: 'PUT',
            body: JSON.stringify({ quantity })
        });
    }

    await loadCartFromServer();
}

function updateTotalCartCount() {
    const floatingCountElem = document.getElementById("floating-count");
    if (floatingCountElem) {
        floatingCountElem.innerText = totalCartCount;
    }

    const headerCountElem = document.getElementById("cart-count");
    if (headerCountElem) {
        headerCountElem.innerText = totalCartCount;
        headerCountElem.style.display = totalCartCount > 0 ? 'inline-block' : 'none';
    }

    const floatingBtn = document.getElementById("floating-checkout");
    if (floatingBtn) {
        if (totalCartCount > 0) {
            floatingBtn.classList.remove("hidden");
        } else {
            floatingBtn.classList.add("hidden");
        }
    }
}

function renderCartModal() {
    const cartItemsContainer = document.getElementById("cart-items");
    const cartTotalElem = document.getElementById("cart-total");
    const checkoutBtn = document.getElementById("checkout-btn");

    cartItemsContainer.innerHTML = "";

    let totalAmount = 0;

    if (cartItems.length === 0) {
        cartItemsContainer.innerHTML = "<p style='text-align:center; color:#666; padding:20px;'>Your cart is empty.</p>";
        if (checkoutBtn) checkoutBtn.disabled = true;
    } else {
        cartItems.forEach((item) => {
            const subtotal = item.price * item.quantity;
            totalAmount += subtotal;

            const itemRow = document.createElement("div");
            itemRow.className = "cart-item-row";
            itemRow.style.cssText = "display: flex; justify-content: space-between; align-items: center; padding: 12px; border-bottom: 1px solid #eee;";

            const itemInfo = document.createElement("div");
            itemInfo.style.flex = "1";
            itemInfo.innerHTML = `<strong>${item.name}</strong><br><small>Qty: ${item.quantity} × $${formatPrice(item.price)}</small>`;

            const itemPrice = document.createElement("div");
            itemPrice.style.minWidth = "80px";
            itemPrice.style.textAlign = "right";
            itemPrice.style.fontWeight = "bold";
            itemPrice.innerHTML = `$${formatPrice(subtotal)}`;

            const deleteBtn = document.createElement("button");
            deleteBtn.innerHTML = "🗑";
            deleteBtn.style.cssText = "background:none; border:none; cursor:pointer; font-size:16px; padding:0 10px; color:#ff5050;";
            deleteBtn.title = "Remove from cart";
            deleteBtn.addEventListener("click", async () => {
                try {
                    await updateCartItem(item.product_id, 0);
                } catch (error) {
                    console.error('Error removing item:', error);
                }
            });

            itemRow.appendChild(itemInfo);
            itemRow.appendChild(itemPrice);
            itemRow.appendChild(deleteBtn);
            cartItemsContainer.appendChild(itemRow);
        });

        if (checkoutBtn) checkoutBtn.disabled = false;
    }

    // Display total with emphasis
    const totalDiv = document.createElement("div");
    totalDiv.style.cssText = "padding: 15px; border-top: 2px solid #667eea; background: #f5f5f5; margin-top: 15px;";
    totalDiv.innerHTML = `<div style='display: flex; justify-content: space-between; font-size: 16px;'><strong>Total Amount:</strong><strong style='color: #667eea; font-size: 18px;'>$${formatPrice(totalAmount)}</strong></div>`;
    cartItemsContainer.appendChild(totalDiv);

    cartTotalElem.innerText = formatPrice(totalAmount);
}

updateTotalCartCount();
renderCartModal();

// Product modal logic
let modal = document.getElementById("product-modal");
let modalImg = document.getElementById("modal-img");
let modalName = document.getElementById("modal-name");
let modalPrice = document.getElementById("modal-price");

const productElements = document.querySelectorAll('.pro');
productElements.forEach(product => {
    product.addEventListener("click", (e) => {
        if (e.target.closest('.cart-controls') || e.target.classList.contains('cart-btn')) {
            return; // don't open product details when clicking + / - buttons
        }

        let img = product.querySelector("img").src;
        let name = product.querySelector("h5").innerText;
        let price = product.querySelector("h4").innerText;
        let brandSelector = product.querySelector("span");
        let brand = brandSelector ? brandSelector.innerText : "Aurelia";
        let id = product.getAttribute('data-product-id');

        localStorage.setItem("selectedProduct", JSON.stringify({ id: parseInt(id), img, name, price, brand }));
        window.location.href = "sproduct.html";
    });
});

/* CLOSE */
document.getElementById("close").onclick = () => {
    modal.style.display = "none";
};

/* CLICK OUTSIDE */
window.onclick = (e) => {
    if (e.target == modal) {
        modal.style.display = "none";
    }
};

// Cart modal open/close
const cartModal = document.getElementById("cart-modal");
const viewCartBtn = document.getElementById("view-cart-btn");
const cartCloseBtn = document.getElementById("cart-close");

viewCartBtn.addEventListener("click", async (e) => {
    e.preventDefault();
    if (isUserLoggedIn()) {
        await loadAddresses();
    }
    cartModal.classList.remove("hidden");
    renderCartModal();
});

cartCloseBtn.addEventListener("click", () => {
    cartModal.classList.add("hidden");
});

window.addEventListener("click", (e) => {
    if (e.target === cartModal) {
        cartModal.classList.add("hidden");
    }
});

const checkoutBtn = document.getElementById("checkout-btn");
checkoutBtn.addEventListener("click", async () => {
    if (totalCartCount === 0) {
        alert("Your cart is empty. Please add items before checking out.");
        return;
    }

    const addressSelect = document.getElementById("checkout-address-select");
    const paymentMethodSelect = document.getElementById("payment-method");
    const selectedAddressId = addressSelect ? parseInt(addressSelect.value, 10) : 0;
    const paymentMethod = paymentMethodSelect ? paymentMethodSelect.value : "cod";

    if (!selectedAddressId) {
        alert("Please add and select a shipping address before checkout.");
        return;
    }

    try {
        console.log("Processing order with", totalCartCount, "items");
        const data = await apiRequest('/api/checkout/create-session', {
            method: 'POST',
            body: JSON.stringify({
                address_id: selectedAddressId,
                payment_method: paymentMethod
            })
        });
        window.location.href = data.checkout_url;
        return;
        const totalAmount = data.total_amount;
        const orderId = data.order_id;
        await loadCartFromServer();

        // Reset product quantities in UI
        const products = document.querySelectorAll(".pro");
        products.forEach((product) => {
            const qtyElem = product.querySelector(".item-qty");
            const minusBtn = product.querySelector(".cart-btn.minus");
            setQtyValue(qtyElem, 0);
            if (minusBtn) minusBtn.disabled = true;
        });

        cartModal.classList.add("hidden");

        const message = `🎉 ORDER CONFIRMED!\n\n` +
            `Order ID: #${orderId}\n` +
            `Total Amount: $${formatPrice(totalAmount)}\n\n` +
            `Thank you for your purchase!`;
        alert(message);

    } catch (error) {
        console.error('Checkout error:', error);
        alert('Error processing order: ' + error.message);
    }
});

// Floating checkout button
const floatingCheckoutBtn = document.getElementById("floating-checkout-btn");
if (floatingCheckoutBtn) {
    floatingCheckoutBtn.addEventListener("click", async (e) => {
        e.preventDefault();
        if (isUserLoggedIn()) {
            await loadAddresses();
        }
        renderCartModal();
        cartModal.classList.remove("hidden");
    });
}

// Display user profile if logged in
function updateUserProfile() {
    const userProfileBtn = document.getElementById("user-profile-btn");
    const userNameDisplay = document.getElementById("user-name-display");
    const navProfileBtn = document.getElementById("nav-profile");

    if (isUserLoggedIn()) {
        if (userNameDisplay) userNameDisplay.innerText = currentUser.name;
        if (userProfileBtn) userProfileBtn.style.display = "flex";
        if (navProfileBtn) navProfileBtn.style.display = "inline-flex";
    } else {
        if (userProfileBtn) userProfileBtn.style.display = "none";
        if (navProfileBtn) navProfileBtn.style.display = "none";
    }
}

// Handle user profile button click (logout)
const userProfileBtn = document.getElementById("user-profile-btn");
if (userProfileBtn) {
    userProfileBtn.addEventListener("click", async (e) => {
        e.preventDefault();
        await openProfileSection("account");
    });
}

// Initialize the application
async function initializeApp() {
    prefillKnownEmail();

    // Theme setup
    const savedTheme = localStorage.getItem('theme');
    if (savedTheme === 'dark') {
        document.body.classList.add('dark-mode');
        const themeBtns = document.querySelectorAll('.theme-toggle i');
        themeBtns.forEach(icon => {
            icon.classList.remove('fa-moon');
            icon.classList.add('fa-sun');
        });
    }

    updateUserProfile();
    try {
        await loadCartFromServer();
        await loadAddresses();
    } catch (error) {
        console.error('Failed to load cart from FastAPI:', error);
        if (isUserLoggedIn()) {
            alert(`FastAPI connection failed: ${error.message}`);
        }
    }

    // Initialize product capabilities
    initializeProductCartControls();
    initializeFiltersAndSorting();
}

// Initialize cart controls for all products
function initializeProductCartControls() {
    if (productControlsInitialized) return;
    productControlsInitialized = true;

    const products = document.querySelectorAll(".pro");

    products.forEach((product, index) => {
        // Use explicit data-product-id if provided, otherwise default to index+1
        const productId = parseInt(product.getAttribute('data-product-id'), 10) || index + 1;
        product.setAttribute("data-product-id", productId);

        // Find existing cart controls
        const controls = product.querySelector(".cart-controls");
        if (!controls) return; // Skip if no controls found

        const minusBtn = controls.querySelector(".cart-btn.minus");
        const plusBtn = controls.querySelector(".cart-btn.plus");
        const qty = controls.querySelector(".item-qty");

        if (!minusBtn || !plusBtn || !qty) return; // Skip if controls are incomplete

        // Initialize quantity display
        const cartItem = cartItems.find(item => item.product_id === productId);
        if (cartItem) {
            setQtyValue(qty, cartItem.quantity);
            minusBtn.disabled = false;
        } else {
            setQtyValue(qty, 0);
            minusBtn.disabled = true;
        }

        // Plus button - Add item to cart
        plusBtn.addEventListener("click", async (e) => {
            e.stopPropagation();

            console.log('+ button clicked for product', productId);
            console.log('isUserLoggedIn():', isUserLoggedIn());
            console.log('currentUser:', currentUser);

            if (!isUserLoggedIn()) {
                console.warn('Adding to cart while not logged in (guest).');
                showSignupModal();
                return;
            }

            const currentQty = getQtyValue(qty) + 1;

            // Limit maximum quantity to 10
            if (currentQty > 10) {
                alert('Maximum quantity per item is 10');
                return;
            }

            // Show loading state
            plusBtn.disabled = true;
            const originalQty = getQtyValue(qty);
            setQtyValue(qty, currentQty);
            minusBtn.disabled = false;

            // Update cart at server
            try {
                await addToCart(productId, 1);
                console.log('Successfully added item', productId);
            } catch (error) {
                console.error('Error adding to cart:', error);
                alert('Failed to add item. Please try again.');
                setQtyValue(qty, originalQty);
                minusBtn.disabled = originalQty === 0;
            } finally {
                plusBtn.disabled = false;
            }
        });

        // Minus button - Remove item from cart
        minusBtn.addEventListener("click", async (e) => {
            e.stopPropagation();

            if (!isUserLoggedIn()) {
                console.warn('Removing from cart while not logged in (guest).');
                showSignupModal();
                return;
            }

            let currentQty = getQtyValue(qty);
            if (currentQty <= 0) return;

            const originalQty = currentQty;
            currentQty -= 1;
            setQtyValue(qty, currentQty);

            if (currentQty === 0) {
                minusBtn.disabled = true;
            }

            // Show loading state
            minusBtn.disabled = true;

            // Update cart at server
            try {
                await updateCartItem(productId, currentQty);
                console.log('Successfully updated item', productId, 'to quantity', currentQty);
            } catch (error) {
                console.error('Error updating cart:', error);
                alert('Failed to remove item. Please try again.');
                setQtyValue(qty, originalQty);
                minusBtn.disabled = false;
            } finally {
                minusBtn.disabled = currentQty === 0;
            }
        });
    });
}

// Start the app when DOM is loaded
document.addEventListener('DOMContentLoaded', () => {
    // Intro Screen Logic
    const introScreen = document.getElementById('intro-screen');
    if (introScreen) {
        document.body.style.overflow = 'hidden'; // Prevent scrolling

        setTimeout(() => {
            introScreen.classList.add('intro-fade-out');
            document.body.style.overflow = 'auto'; // Re-enable scrolling

            setTimeout(() => {
                introScreen.remove();
            }, 1000); // Wait for fade-out transition
        }, 3500); // Show intro for 3.5s
    }

    initializeApp();
});

// Theme Toggle Logic
window.toggleTheme = function () {
    const body = document.body;
    body.classList.toggle('dark-mode');

    const isDarkMode = body.classList.contains('dark-mode');
    const themeBtns = document.querySelectorAll('.theme-toggle i');

    themeBtns.forEach(icon => {
        if (isDarkMode) {
            icon.classList.remove('fa-moon');
            icon.classList.add('fa-sun');
        } else {
            icon.classList.remove('fa-sun');
            icon.classList.add('fa-moon');
        }
    });

    localStorage.setItem('theme', isDarkMode ? 'dark' : 'light');
};

// Product Filtering and Sorting Logic
function initializeFiltersAndSorting() {
    const categoryFilter = document.getElementById("category-filter");
    const brandFilter = document.getElementById("brand-filter");
    const priceSort = document.getElementById("price-sort");
    const proContainer = document.querySelector(".pro-container");
    const urlParams = new URLSearchParams(window.location.search);
    const searchQuery = (urlParams.get('search') || '').trim().toLowerCase();

    if (!brandFilter || !priceSort || !proContainer) return;

    // Convert initial NodeList to Array to save default order
    const defaultProducts = Array.from(proContainer.children);

    function detectCategory(product) {
        const brand = (product.querySelector(".des span")?.innerText || "").toLowerCase();
        const name = (product.querySelector(".des h5")?.innerText || "").toLowerCase();

        const shoesKeywords = [
            "shoe", "shoes", "sneaker", "sneakers", "footwear"
        ];
        const electronicsKeywords = [
            "phone", "smartphone", "laptop", "headphone", "watch", "electronics", "gadget", "tablet", "camera"
        ];
        const clothingKeywords = [
            "shirt", "t-shirt", "tshirt", "pant", "pants", "dress", "kurti", "cloth", "fashion"
        ];

        if (shoesKeywords.some(keyword => name.includes(keyword))) return "shoes";
        if (["apple", "msi", "boat"].includes(brand)) return "electronics";
        if (electronicsKeywords.some(keyword => name.includes(keyword))) return "electronics";
        if (brand === "adidas") return "shoes";
        if (brand === "aurelia") return "clothes";
        if (clothingKeywords.some(keyword => name.includes(keyword))) return "clothes";
        return "other";
    }

    function updateProducts() {
        const category = categoryFilter ? categoryFilter.value : "all";
        const brand = brandFilter.value;
        const sortMode = priceSort.value;

        // Filter
        let visibleProducts = defaultProducts.filter(pro => {
            const proCategory = detectCategory(pro);
            const categoryMatches = category === "all" || proCategory === category;
            const proBrand = pro.querySelector(".des span").innerText.trim();
            const brandMatches = brand === "all" || proBrand === brand;
            const proName = pro.querySelector(".des h5").innerText.trim();
            const searchText = `${proName} ${proBrand} ${proCategory}`.toLowerCase();
            const searchTerms = searchQuery.split(/\s+/).filter(Boolean);
            const searchMatches = searchTerms.length === 0 || searchTerms.every(term => searchText.includes(term));
            return categoryMatches && brandMatches && searchMatches;
        });

        // Sort
        if (sortMode === 'low-to-high') {
            visibleProducts.sort((a, b) => {
                const priceA = parseFloat(a.querySelector(".des h4").innerText.replace(/[^0-9.]/g, ''));
                const priceB = parseFloat(b.querySelector(".des h4").innerText.replace(/[^0-9.]/g, ''));
                return priceA - priceB;
            });
        } else if (sortMode === 'high-to-low') {
            visibleProducts.sort((a, b) => {
                const priceA = parseFloat(a.querySelector(".des h4").innerText.replace(/[^0-9.]/g, ''));
                const priceB = parseFloat(b.querySelector(".des h4").innerText.replace(/[^0-9.]/g, ''));
                return priceB - priceA;
            });
        } else if (sortMode === 'a-to-z') {
            visibleProducts.sort((a, b) => {
                const nameA = a.querySelector(".des h5").innerText.toLowerCase();
                const nameB = b.querySelector(".des h5").innerText.toLowerCase();
                return nameA.localeCompare(nameB);
            });
        }

        // Empty container and re-append
        proContainer.innerHTML = '';
        if (visibleProducts.length === 0) {
            const emptyMessage = document.createElement('p');
            emptyMessage.className = 'no-products-message';
            emptyMessage.innerText = searchQuery
                ? `No products found for "${searchQuery}".`
                : 'No products match the selected filters.';
            proContainer.appendChild(emptyMessage);
        } else {
            visibleProducts.forEach(pro => proContainer.appendChild(pro));
        }

        // Ensure cart controls sync after DOM manipulation
        syncProductQtyUI();
    }

    if (categoryFilter) {
        categoryFilter.addEventListener('change', updateProducts);
    }
    brandFilter.addEventListener('change', updateProducts);
    priceSort.addEventListener('change', updateProducts);

    // Parse URL parameters for automatic filtering
    const brandParam = urlParams.get('brand');

    let shouldUpdate = !!searchQuery;
    if (brandParam) {
        const options = Array.from(brandFilter.options);
        const match = options.find(opt => opt.value.toLowerCase() === brandParam.toLowerCase());
        if (match) {
            brandFilter.value = match.value;
            shouldUpdate = true;
        }
    }

    if (shouldUpdate) {
        updateProducts();
    }
}

document.addEventListener('DOMContentLoaded', async () => {
    const params = new URLSearchParams(window.location.search);
    const accountTab = params.get("account");
    if (accountTab && isUserLoggedIn()) {
        await openProfileSection(accountTab);
        if (params.get("addAddress") === "1") {
            showAddressForm();
        }
    }
});


