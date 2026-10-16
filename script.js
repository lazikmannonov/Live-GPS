"use strict";

/* =========================================================
   LIVE GPS — CLIENT
   ========================================================= */

/* ---------- STORAGE KEYS (o'zgarmagan) ---------- */

const SAVED_GROUPS_KEY = "gps-saved-groups";
const USER_ID_KEY = "gps-user-id";
const USER_NAME_KEY = "gps-user-name";
const ROOM_CODE_KEY = "gps-room-code";
const LAST_ROOM_KEY = "gps-last-room-code";
const THEME_KEY = "gps-theme";

const MAX_SAVED_GROUPS = 20;
const LOCATION_MIN_INTERVAL = 1500;
const DEFAULT_CENTER = [69.2401, 41.2995]; // [lng, lat] — Toshkent

const store = {
    get(key, fallback = null) {
        try {
            const value = localStorage.getItem(key);
            return value === null ? fallback : value;
        } catch (e) {
            return fallback;
        }
    },
    set(key, value) {
        try { localStorage.setItem(key, value); } catch (e) { /* ignore */ }
    },
    remove(key) {
        try { localStorage.removeItem(key); } catch (e) { /* ignore */ }
    }
};


/* =========================================================
   HELPERS
   ========================================================= */

const $ = id => document.getElementById(id);

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

function normalizeRoomCode(value) {
    return String(value || "")
        .trim()
        .toUpperCase()
        .replace(/[^A-Z0-9]/g, "")
        .slice(0, 6);
}

const isValidRoomCode = code => /^[A-Z0-9]{6}$/.test(code);

const isValidUserId = value => /^[a-f0-9]{16}$/i.test(String(value || ""));

function cleanName(value) {
    return String(value || "").trim().slice(0, 100);
}

function escapeHtml(value) {
    return String(value ?? "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
}

/* null / "" / undefined — Number() orqali 0 bo'lib ketmasligi uchun */
function toCoord(value) {
    if (value === null || value === undefined || value === "") return NaN;
    return Number(value);
}

function validCoords(lat, lng) {
    lat = toCoord(lat);
    lng = toCoord(lng);

    return (
        Number.isFinite(lat) &&
        Number.isFinite(lng) &&
        Math.abs(lat) <= 90 &&
        Math.abs(lng) <= 180 &&
        !(lat === 0 && lng === 0)
    );
}

function hueFromString(text) {
    let hash = 0;
    const value = String(text || "?");

    for (let i = 0; i < value.length; i++) {
        hash = (hash * 31 + value.charCodeAt(i)) % 360;
    }

    return hash;
}

function userGradient(name) {
    const hue = hueFromString(name);

    return `linear-gradient(135deg,hsl(${hue} 72% 54%),hsl(${(hue + 40) % 360} 72% 44%))`;
}

function calculateDistance(lat1, lon1, lat2, lon2) {
    const R = 6371000;
    const toRad = deg => deg * Math.PI / 180;

    const dLat = toRad(lat2 - lat1);
    const dLon = toRad(lon2 - lon1);

    const a =
        Math.sin(dLat / 2) ** 2 +
        Math.cos(toRad(lat1)) *
        Math.cos(toRad(lat2)) *
        Math.sin(dLon / 2) ** 2;

    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function formatDistance(meters) {
    return meters < 1000
        ? `${Math.round(meters)} m`
        : `${(meters / 1000).toFixed(1)} km`;
}

function formatAccuracy(accuracy) {
    if (!Number.isFinite(accuracy)) return "aniqlik noma’lum";

    return accuracy >= 1000
        ? `±${(accuracy / 1000).toFixed(1)} km`
        : `±${Math.round(accuracy)} m`;
}

function formatLastSeen(lastSeen, online) {
    if (online) return "Online · hozir";

    if (!lastSeen) return "Oxirgi faollik noma’lum";

    const date = new Date(lastSeen);

    if (!Number.isFinite(date.getTime())) {
        return "Oxirgi faollik noma’lum";
    }

    const minutes = Math.max(
        0,
        Math.floor((Date.now() - date.getTime()) / 60000)
    );

    if (minutes < 1) return "1 minutdan kam oldin online edi";
    if (minutes < 60) return `${minutes} minut oldin online edi`;

    const hours = Math.floor(minutes / 60);

    if (hours < 24) {
        return `${hours} soat oldin online edi`;
    }

    const days = Math.floor(hours / 24);

    return `${days} kun oldin online edi`;
}

function formatLastSeenClock(lastSeen) {
    if (!lastSeen) return "";

    const date = new Date(lastSeen);

    if (!Number.isFinite(date.getTime())) return "";

    return date.toLocaleTimeString("uz-UZ", {
        hour: "2-digit",
        minute: "2-digit"
    });
}

    });

    if (minutes < 1) {
        return `Hozirgina offline bo‘lgan · ${time}`;
    }

    if (minutes < 60) {
        return `${minutes} daqiqa oldin onlayn bo‘lgan · ${time}`;
    }

    const hours = Math.floor(minutes / 60);

    if (hours < 24) {
        return `${hours} soat oldin onlayn bo‘lgan · ${time}`;
    }

    const dateText = date.toLocaleDateString("uz-UZ", {
        day: "numeric",
        month: "long"
    });

    return `${dateText}, ${time}`;
}

/* =========================================================
   STATE
   ========================================================= */

let ws = null;

let currentUserId = store.get(USER_ID_KEY);
let currentUserName = store.get(USER_NAME_KEY, "");

let currentRoomCode = normalizeRoomCode(
    store.get(ROOM_CODE_KEY) || store.get(LAST_ROOM_KEY) || ""
);

let pendingAction = null;
let pendingActionSent = false;

let reconnectTimer = null;
let reconnectAttempts = 0;
let manuallyClosed = false;

let watchId = null;
let myLatitude = null;
let myLongitude = null;
let myAccuracy = null;

let lastSentAt = 0;
let sendTimer = null;

let map = null;
let schemeLayer = null;
let mapInitialized = false;
let mapPromise = null;
let firstLocationCentered = false;

let myMarker = null; // { marker, element }
const userMarkers = new Map(); // id -> { marker, element }

let users = [];
let savedGroups = [];

let switchPendingAction = null;
let switchFallbackTimer = null;

let eventsInitialized = false;


/* =========================================================
   STATUS & ERRORS
   ========================================================= */

const STATUS_CLASSES = ["online", "offline", "connecting", "error"];

function applyStatusClass(element, type) {
    if (!element) return;

    element.classList.remove(...STATUS_CLASSES);

    if (type) element.classList.add(type);
}

function setConnectionStatus(text, type = "") {
    const status = $("connectionStatus");

    if (status) {
        status.textContent = text;
        applyStatusClass(status, type);
    }

    applyStatusClass($("connectionPill"), type);

    const pillText = $("connectionText");

    if (pillText) {
        pillText.textContent = {
            online: "Online",
            offline: "Offline",
            connecting: "Ulanmoqda...",
            error: "Xatolik"
        }[type] || text;
    }
}

function setLocationStatus(text, type = "") {
    const element = $("locationStatus");

    if (!element) return;

    element.textContent = text;
    applyStatusClass(element, type);
}

function showError(id, message) {
    const element = $(id);

    if (!element) {
        console.error(message);
        return;
    }

    element.textContent = message;
    element.classList.add("show");
}

function clearError(id) {
    const element = $(id);

    if (!element) return;

    element.textContent = "";
    element.classList.remove("show");
}

const showSetupError = message => showError("setupError", message);
const showRoomError = message => showError("roomError", message);

function clearErrors() {
    clearError("setupError");
    clearError("roomError");
}


/* =========================================================
   VIEWS
   ========================================================= */

function showSetup() {
    $("setupCard")?.classList.remove("hidden");
    $("roomCard")?.classList.add("hidden");

    clearError("roomError");
}

function showRoom() {
    $("setupCard")?.classList.add("hidden");
    $("roomCard")?.classList.remove("hidden");

    clearError("setupError");

    /* Xona ko'ringandan keyin xarita yaratiladi */
    requestAnimationFrame(() => initMap());
}

function updateRoomCodeUI(code) {
    const normalized = normalizeRoomCode(code);

    const current = $("currentRoomCode");

    if (current) current.textContent = normalized || "------";

    const input = $("roomCode");

    if (input && normalized) input.value = normalized;

    const switchInput = $("switchRoomInput");

    if (switchInput) switchInput.value = "";
}


/* =========================================================
   SAVED GROUPS
   ========================================================= */

function loadSavedGroups() {
    try {
        const parsed = JSON.parse(store.get(SAVED_GROUPS_KEY, "[]"));

        savedGroups = Array.isArray(parsed)
            ? parsed.filter(group => group && isValidRoomCode(normalizeRoomCode(group.code)))
            : [];
    } catch (error) {
        console.error("Saved groups error:", error);
        savedGroups = [];
    }

    renderSavedGroups();
}

function saveSavedGroups() {
    store.set(SAVED_GROUPS_KEY, JSON.stringify(savedGroups));
}

function addSavedGroup(roomCode, name) {
    const code = normalizeRoomCode(roomCode);

    if (!isValidRoomCode(code)) return;

    const existing = savedGroups.find(group => group.code === code);

    const finalName =
        String(name || existing?.name || "Guruh")
            .trim()
            .slice(0, 100) || "Guruh";

    savedGroups = [
        { code, name: finalName, savedAt: Date.now() },
        ...savedGroups.filter(group => group.code !== code)
    ].slice(0, MAX_SAVED_GROUPS);

    saveSavedGroups();
    renderSavedGroups();
}

function removeSavedGroup(roomCode) {
    const code = normalizeRoomCode(roomCode);

    if (!isValidRoomCode(code)) return;

    if (ws && ws.readyState === WebSocket.OPEN && currentUserId) {
        ws.send(JSON.stringify({
            type: "delete-saved-group",
            roomCode: code,
            userId: currentUserId
        }));
    }

    savedGroups = savedGroups.filter(
        group => normalizeRoomCode(group.code) !== code
    );

    saveSavedGroups();
    renderSavedGroups();

    if (normalizeRoomCode(store.get(LAST_ROOM_KEY)) === code) {
        store.remove(LAST_ROOM_KEY);
    }

    if (currentRoomCode === code) {
        cancelSwitch();
        resetRoomState(true);
    }
}

function renderSavedGroups() {
    const list = $("savedGroupsList");
    const count = $("savedGroupsCount");

    if (count) count.textContent = String(savedGroups.length);

    if (!list) return;

    if (savedGroups.length === 0) {
        list.innerHTML = `
            <div class="empty-members">
                Hozircha saqlangan guruh yo‘q.
            </div>
        `;
        return;
    }

    list.innerHTML = savedGroups.map(group => `
        <div class="saved-group-item" data-code="${escapeHtml(group.code)}">

            <div class="saved-group-info">
                <span class="saved-group-name">${escapeHtml(group.name || "Guruh")}</span>
                <strong class="saved-group-code">${escapeHtml(group.code)}</strong>
            </div>

            <div class="saved-group-actions">
                <button type="button" class="saved-join-btn" data-action="join">
                    Kirish
                </button>

                <button
                    type="button"
                    class="saved-delete-btn"
                    data-action="delete"
                    title="O‘chirish"
                    aria-label="Guruhni o‘chirish"
                >×</button>
            </div>

        </div>
    `).join("");
}

function onSavedGroupsClick(event) {
    const button = event.target.closest("button[data-action]");

    if (!button) return;

    const item = button.closest("[data-code]");

    if (!item) return;

    const code = item.dataset.code;

    if (button.dataset.action === "join") {
        joinByCode(code, getInputName());
    } else if (button.dataset.action === "delete") {
        removeSavedGroup(code);
    }
}


/* =========================================================
   ROOM STATE
   ========================================================= */

function persistRoom(code) {
    currentRoomCode = code;

    store.set(ROOM_CODE_KEY, code);
    store.set(LAST_ROOM_KEY, code);
}

function persistName(name) {
    currentUserName = name;

    store.set(USER_NAME_KEY, name);
}

function setUserId(id) {
    currentUserId = String(id);

    store.set(USER_ID_KEY, currentUserId);
}

/* Xonadan lokal chiqish. keepUI=false bo'lsa, setup ko'rsatilmaydi. */
function resetRoomState(showUI = true) {
    currentRoomCode = "";

    store.remove(ROOM_CODE_KEY);

    pendingAction = null;
    pendingActionSent = false;

    stopLocationTracking();

    users = [];

    clearMapMarkers();
    renderUsers();

    if (showUI) showSetup();
}

function startAction(action) {
    pendingAction = action;
    pendingActionSent = false;

    connectWebSocket();
}

function cancelSwitch() {
    switchPendingAction = null;

    if (switchFallbackTimer) {
        clearTimeout(switchFallbackTimer);
        switchFallbackTimer = null;
    }
}


/* =========================================================
   WEBSOCKET
   ========================================================= */

function getWebSocketUrl() {
    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";

    return `${protocol}//${window.location.host}`;
}

function connectWebSocket() {
    manuallyClosed = false;

    if (ws && ws.readyState === WebSocket.OPEN) {
        sendPendingAction();
        return;
    }

    if (ws && ws.readyState === WebSocket.CONNECTING) return;

    pendingActionSent = false;

    setConnectionStatus("Ulanmoqda...", "connecting");

    let socket;

    try {
        socket = new WebSocket(getWebSocketUrl());
    } catch (error) {
        console.error("WebSocket yaratish xatosi:", error);

        setConnectionStatus("Ulanish xatosi", "error");
        scheduleReconnect();

        return;
    }

    ws = socket;

    socket.addEventListener("open", () => {
        reconnectAttempts = 0;

        setConnectionStatus("Ulangan", "online");

        /* Action serverdan "connected" kelgach yuboriladi. */
    });

    socket.addEventListener("message", handleServerMessage);

    socket.addEventListener("error", error => {
        console.error("WebSocket error:", error);

        setConnectionStatus("Ulanish xatosi", "error");
    });

    socket.addEventListener("close", () => {
        /* Eski socketning close hodisasi yangisiga tegmasin */
        if (ws !== socket) return;

        pendingActionSent = false;

        setConnectionStatus("Ulanish uzildi", "offline");

        if (!manuallyClosed) scheduleReconnect();
    });
}

function scheduleReconnect() {
    if (manuallyClosed || reconnectTimer) return;

    reconnectAttempts++;

    const delay = Math.min(
        1000 * Math.pow(2, Math.min(reconnectAttempts - 1, 5)),
        10000
    );

    reconnectTimer = setTimeout(() => {
        reconnectTimer = null;
        connectWebSocket();
    }, delay);
}

function ensureConnected() {
    if (manuallyClosed) return;

    if (
        ws &&
        (
            ws.readyState === WebSocket.OPEN ||
            ws.readyState === WebSocket.CONNECTING
        )
    ) {
        return;
    }

    if (reconnectTimer) {
        clearTimeout(reconnectTimer);
        reconnectTimer = null;
    }

    connectWebSocket();
}

function sendPendingAction() {
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    if (!pendingAction || pendingActionSent) return;

    const name = cleanName(pendingAction.name || currentUserName || "Noma'lum");

    if (!name) return;

    if (pendingAction.type === "create") {
        ws.send(JSON.stringify({
            type: "create-room",
            userId: currentUserId || null,
            name
        }));

        pendingActionSent = true;
        return;
    }

    if (pendingAction.type === "join") {
        const roomCode = normalizeRoomCode(pendingAction.roomCode);

        if (!isValidRoomCode(roomCode)) return;

        ws.send(JSON.stringify({
            type: "join-room",
            roomCode,
            userId: currentUserId || null,
            name
        }));

        pendingActionSent = true;
    }
}


/* =========================================================
   SERVER MESSAGES
   ========================================================= */

function handleServerMessage(event) {
    let data;

    try {
        data = JSON.parse(event.data);
    } catch (error) {
        console.error("Server JSON xatosi:", event.data);
        return;
    }

    switch (data.type) {

        case "connected":
            onConnected(data);
            break;

        case "room-created":
            enterRoom(data, true);
            break;

        case "joined-room":
            enterRoom(data, false);
            break;

        case "users":
            users = Array.isArray(data.users) ? data.users : [];

            renderUsers();
            updateMapUsers();
            break;

        case "left-room":
            onLeftRoom();
            break;

        case "removed-from-room":
            onRemovedFromRoom(data);
            break;

        case "error":
            onServerError(data);
            break;

        default:
            break;
    }
}

function onConnected(data) {
    if (!currentUserId && isValidUserId(data.userId)) {
        setUserId(data.userId);
    }

    if (!pendingAction && currentRoomCode && currentUserName) {
        pendingAction = {
            type: "join",
            roomCode: currentRoomCode,
            name: currentUserName
        };

        pendingActionSent = false;
    }

    sendPendingAction();
}

function enterRoom(data, created) {
    const code = normalizeRoomCode(data.roomCode);

    if (!isValidRoomCode(code)) {
        pendingAction = null;
        pendingActionSent = false;

        showSetup();
        showSetupError("Server noto‘g‘ri guruh kodi yubordi.");

        return;
    }

    if (data.userId && !currentUserId) setUserId(data.userId);

    persistRoom(code);

    addSavedGroup(code, created ? "Mening guruhim" : "");

    updateRoomCodeUI(code);

    pendingAction = null;
    pendingActionSent = false;

    if (created) users = [];

    clearMapMarkers();
    renderUsers();

    firstLocationCentered = false;

    clearErrors();
    showRoom();

    setConnectionStatus("Ulangan", "online");

    startLocationTracking();
    sendLocation(true);

    initMap();
}

function onLeftRoom() {
    const switching = !!switchPendingAction;

    /* LAST_ROOM_KEY saqlanadi — keyin qayta kirish mumkin */
    resetRoomState(!switching);

    setConnectionStatus("Ulangan", "online");

    if (switching) finishSwitch();
}

function onRemovedFromRoom(data) {
    const code = normalizeRoomCode(data.roomCode);

    /* Boshqa qurilmadan shu foydalanuvchi o'chirilgan */
    if (
        String(data.userId) === String(currentUserId) &&
        currentRoomCode === code
    ) {
        if (normalizeRoomCode(store.get(LAST_ROOM_KEY)) === code) {
            store.remove(LAST_ROOM_KEY);
        }

        resetRoomState(true);
    }
}

function onServerError(data) {
    const message = data.message || "Xatolik yuz berdi.";

    console.error("SERVER ERROR:", message);

    const wasPending = !!pendingAction;

    pendingAction = null;
    pendingActionSent = false;

    cancelSwitch();

    /* Guruh topilmasa ham saqlangan guruh o'chirilmaydi
       (server uxlab qolgan yoki qayta ishga tushgan bo'lishi mumkin). */
    if (message.includes("Bunday guruh topilmadi")) {
        showSetup();

        showSetupError(
            "Guruhga hozircha ulanib bo‘lmadi. Saqlangan guruh o‘chirilmagan. Keyinroq qayta urinib ko‘ring."
        );

        return;
    }

    const roomVisible = !$("roomCard")?.classList.contains("hidden");

    if (roomVisible && !wasPending) {
        showRoomError(message);
    } else {
        showSetup();
        showSetupError(message);
    }
}


/* =========================================================
   FORM ACTIONS
   ========================================================= */

function getInputName() {
    return cleanName($("userName")?.value || currentUserName);
}

function createRoom() {
    clearErrors();

    const input = $("userName");
    const name = cleanName(input?.value);

    if (!name) {
        showSetupError("Avval ismingizni kiriting.");
        input?.focus();
        return;
    }

    persistName(name);

    currentRoomCode = "";

    startAction({ type: "create", name });
}

function joinByCode(code, name) {
    clearErrors();

    const roomCode = normalizeRoomCode(code);

    if (!isValidRoomCode(roomCode)) {
        showSetupError("Guruh kodi 6 ta harf yoki raqamdan iborat bo‘lishi kerak.");
        $("roomCode")?.focus();
        return;
    }

    const finalName = cleanName(name);

    if (!finalName) {
        showSetupError("Avval ismingizni kiriting.");
        $("userName")?.focus();
        return;
    }

    persistName(finalName);
    persistRoom(roomCode);

    const nameInput = $("userName");
    const codeInput = $("roomCode");

    if (nameInput) nameInput.value = finalName;
    if (codeInput) codeInput.value = roomCode;

    startAction({ type: "join", roomCode, name: finalName });
}

function joinRoom() {
    joinByCode($("roomCode")?.value, getInputName());
}

function finishSwitch() {
    if (switchFallbackTimer) {
        clearTimeout(switchFallbackTimer);
        switchFallbackTimer = null;
    }

    if (!switchPendingAction) return;

    const action = switchPendingAction;

    switchPendingAction = null;

    persistRoom(normalizeRoomCode(action.roomCode));

    startAction(action);
}

function switchRoom() {
    clearErrors();

    const code = normalizeRoomCode($("switchRoomInput")?.value);

    if (!isValidRoomCode(code)) {
        showRoomError("Guruh kodi noto‘g‘ri.");
        return;
    }

    const name = currentUserName || getInputName();

    if (!name) {
        showRoomError("Avval ismingizni kiriting.");
        return;
    }

    if (normalizeRoomCode(currentRoomCode) === code) {
        showRoomError("Siz hozir shu guruhdasiz.");
        return;
    }

    const nextAction = { type: "join", roomCode: code, name };

    /* Avval eski guruhdan chiqamiz */
    if (ws && ws.readyState === WebSocket.OPEN && currentRoomCode) {
        switchPendingAction = nextAction;

        ws.send(JSON.stringify({ type: "leave-room" }));

        /* Server left-room'ni kechiktirsa, 1.5 soniyadan keyin baribir ulanamiz */
        if (switchFallbackTimer) clearTimeout(switchFallbackTimer);

        switchFallbackTimer = setTimeout(finishSwitch, 1500);

        return;
    }

    persistRoom(code);

    startAction(nextAction);
}

function leaveGroup() {
    if (ws && ws.readyState === WebSocket.OPEN && currentRoomCode) {
        try {
            ws.send(JSON.stringify({ type: "leave-room" }));
        } catch (error) {
            console.error("Leave error:", error);
        }
    }

    /* Oxirgi guruh LAST_ROOM_KEY'da qoladi */
    if (currentRoomCode) store.set(LAST_ROOM_KEY, currentRoomCode);

    cancelSwitch();
    resetRoomState(true);

    setConnectionStatus("Ulangan", "online");
}

function restoreSession() {
    loadSavedGroups();

    const nameInput = $("userName");

    if (nameInput && currentUserName) nameInput.value = currentUserName;

    const storedRoom = normalizeRoomCode(
        store.get(ROOM_CODE_KEY) || store.get(LAST_ROOM_KEY) || ""
    );

    if (isValidRoomCode(storedRoom)) {
        currentRoomCode = storedRoom;

        store.set(LAST_ROOM_KEY, storedRoom);
    }

    if (currentRoomCode && currentUserName) {
        setConnectionStatus("Guruhga ulanmoqda...", "connecting");

        startAction({
            type: "join",
            roomCode: currentRoomCode,
            name: currentUserName
        });

        return;
    }

    showSetup();
}

function sendName() {
    if (!ws || ws.readyState !== WebSocket.OPEN || !currentRoomCode) return;

    const name = getInputName();

    if (!name) return;

    persistName(name);

    ws.send(JSON.stringify({ type: "name", name }));
}


/* =========================================================
   LOCATION
   ========================================================= */

function startLocationTracking() {
    if (!navigator.geolocation) {
        setLocationStatus("Brauzer GPSni qo‘llamaydi", "error");
        return;
    }

    if (!window.isSecureContext) {
        setLocationStatus("Sayt HTTPS orqali ochilishi kerak", "error");
        return;
    }

    if (watchId !== null) return;

    setLocationStatus("Joylashuv so‘ralmoqda...", "connecting");

    watchId = navigator.geolocation.watchPosition(
        position => {
            const { latitude, longitude, accuracy } = position.coords;

            if (!validCoords(latitude, longitude)) {
                setLocationStatus("GPS koordinatalari noto‘g‘ri", "error");
                return;
            }

            myLatitude = Number(latitude);
            myLongitude = Number(longitude);
            myAccuracy = Number.isFinite(Number(accuracy)) ? Number(accuracy) : null;

            setLocationStatus(
                `Joylashuv olindi (${formatAccuracy(myAccuracy)})`,
                "online"
            );

            updateMyMarker();
            sendLocation();
            renderUsers();
        },

        error => {
            console.error("GPS ERROR:", error.code, error.message);

            if (error.code === 1) {
                setLocationStatus("Brauzerda joylashuvga ruxsat bering", "error");
            } else if (error.code === 2) {
                setLocationStatus("Joylashuv topilmadi. GPSni tekshiring", "error");
            } else if (error.code === 3) {
                setLocationStatus("GPS sekin javob bermoqda. Kutilmoqda...", "connecting");
            } else {
                setLocationStatus("GPS xatosi: sahifani qayta oching", "error");
            }
        },

        {
            enableHighAccuracy: true,
            maximumAge: 5000,
            timeout: 60000
        }
    );
}

function stopLocationTracking() {
    if (watchId !== null) {
        navigator.geolocation.clearWatch(watchId);
        watchId = null;
    }

    if (sendTimer) {
        clearTimeout(sendTimer);
        sendTimer = null;
    }

    myLatitude = null;
    myLongitude = null;
    myAccuracy = null;

    setLocationStatus("Joylashuv o‘chirilgan", "offline");
}

/* Serverga juda tez-tez yubormaslik (throttle) — oxirgi qiymat albatta yuboriladi */
function sendLocation(force = false) {
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    if (!currentRoomCode) return;
    if (!validCoords(myLatitude, myLongitude)) return;

    const wait = LOCATION_MIN_INTERVAL - (Date.now() - lastSentAt);

    if (!force && wait > 0) {
        if (!sendTimer) {
            sendTimer = setTimeout(() => {
                sendTimer = null;
                sendLocation(true);
            }, wait);
        }

        return;
    }

    lastSentAt = Date.now();

    ws.send(JSON.stringify({
        type: "location",
        lat: myLatitude,
        lng: myLongitude,
        accuracy: Number.isFinite(myAccuracy) ? myAccuracy : null
    }));
}


/* =========================================================
   MEMBERS UI
   ========================================================= */

function renderUsers() {
    const list = $("membersList");
    const count = $("membersCount");

    if (count) {
        count.textContent = String(users.filter(user => user.online).length);
    }

    if (!list) return;

    if (users.length === 0) {
        list.innerHTML = `
            <div class="empty-members">
                Hozircha guruhda hech kim yo‘q.
            </div>
        `;
        return;
    }

    const isMe = user => String(user.id) === String(currentUserId);

    /* Avval o'zim, keyin online, keyin offline */
    const sorted = [...users].sort((a, b) => {
        if (isMe(a) !== isMe(b)) return isMe(a) ? -1 : 1;
        if (!!a.online !== !!b.online) return a.online ? -1 : 1;

        return String(a.name || "").localeCompare(String(b.name || ""));
    });

    list.innerHTML = sorted.map(user => {
        const me = isMe(user);
        const name = user.name || "Noma'lum";
        const hasLocation = validCoords(user.lat, user.lng);
        const hasMine = validCoords(myLatitude, myLongitude);

        let text;

        if (me) {
            text = Number.isFinite(myAccuracy)
                ? `Siz · ${formatAccuracy(myAccuracy)}`
                : "Siz";
        } else if (hasLocation && hasMine) {
            const distance = formatDistance(
                calculateDistance(
                    myLatitude,
                    myLongitude,
                    toCoord(user.lat),
                    toCoord(user.lng)
                )
            );

            text = user.online ? distance : `${distance} · oxirgi joylashuv`;
        } else if (hasLocation) {
            text = user.online ? "Online" : "Oxirgi joylashuv saqlangan";
        } else {
            text = user.online ? "Joylashuv kutilmoqda..." : "Offline";
        }

        const avatarStyle = me ? "" : ` style="background:${userGradient(name)}"`;
        
        const lastSeenText = me
            ? ""
            : formatLastSeen(user.lastSeen, user.online);

        const lastSeenClock = me
            ? ""
            : formatLastSeenClock(user.lastSeen);

        return `
            <div class="member${me ? " me" : ""}" data-id="${escapeHtml(user.id)}">
                <div class="member-avatar"${avatarStyle}>
                    ${escapeHtml(name.charAt(0).toUpperCase())}
                </div>

                <div class="member-info">
                    <div class="member-name">
                        ${escapeHtml(name)}
                        ${me ? '<span class="you-badge">SIZ</span>' : ""}
                    </div>

                    <div class="member-distance">
                        ${escapeHtml(text)}
                    </div>

                    ${!me ? `
                        <div class="member-last-seen">
                            ${escapeHtml(lastSeenText)}
                        </div>
                        ${lastSeenClock ? `
                            <div class="member-last-seen-clock">
                                Oxirgi faollik: ${escapeHtml(lastSeenClock)}
                            </div>
                        ` : ""}
                    ` : ""}

                    <span
                        class="member-status ${user.online ? "online" : "offline"}"
                        title="${user.online ? "Online" : "Offline"}"
                    ></span>
                </div>
            </div>
        `;

    }).join("");
}

function onMembersClick(event) {
    const item = event.target.closest(".member[data-id]");

    if (!item) return;

    const user = users.find(u => String(u.id) === item.dataset.id);

    if (user) centerMapOnUser(user);
}


/* =========================================================
   YANDEX MAP
   ========================================================= */

const getTheme = () =>
    document.body.classList.contains("dark") ? "dark" : "light";

async function waitForYmaps() {
    for (let i = 0; i < 50; i++) {
        if (typeof ymaps3 !== "undefined") return true;

        await sleep(300);
    }

    return false;
}

function initMap() {
    if (mapInitialized) {
        updateMyMarker();
        updateMapUsers();

        return Promise.resolve();
    }

    /* Bir vaqtda ikkita xarita yaratilmasligi uchun */
    if (mapPromise) return mapPromise;

    const mapElement = $("map");

    if (!mapElement) return Promise.resolve();

    if ($("roomCard")?.classList.contains("hidden")) return Promise.resolve();

    mapPromise = (async () => {
        try {
            if (!(await waitForYmaps())) {
                showRoomError("Xarita yuklanmadi. Internetni tekshirib, sahifani yangilang.");
                return;
            }

            await ymaps3.ready;

            const { YMap, YMapDefaultSchemeLayer, YMapDefaultFeaturesLayer } = ymaps3;

            const hasMine = validCoords(myLatitude, myLongitude);

            map = new YMap(mapElement, {
                location: {
                    center: hasMine ? [myLongitude, myLatitude] : DEFAULT_CENTER,
                    zoom: hasMine ? 15 : 12
                }
            });

            schemeLayer = new YMapDefaultSchemeLayer({ theme: getTheme() });

            map.addChild(schemeLayer);
            map.addChild(new YMapDefaultFeaturesLayer());

            mapInitialized = true;

            /* Xarita fonini bosganda tanlangan nomlar yopiladi */
            mapElement.addEventListener("click", clearSelectedMarkers);

            updateMyMarker();
            updateMapUsers();

        } catch (error) {
            console.error("Yandex map error:", error);
            showRoomError("Xarita yuklanmadi. Internet yoki API cheklovini tekshiring.");
        } finally {
            mapPromise = null;
        }
    })();

    return mapPromise;
}

/* =========================================================
   MARKERS
   ========================================================= */

const SELECTED_CLASS = "gps-marker-selected";

function clearSelectedMarkers() {
    document
        .querySelectorAll(`.${SELECTED_CLASS}`)
        .forEach(element => element.classList.remove(SELECTED_CLASS));
}

function updateMarkerElement(element, user, isMe = false) {
    if (!element) return;

    const online = isMe || user.online !== false;
    const name = user.name || (isMe ? "Siz" : "Noma'lum");

    element.classList.toggle("offline", !online);

    const initial = element.querySelector(".gps-marker-initial");
    const nameEl = element.querySelector(".gps-marker-name");
    const statusEl = element.querySelector(".gps-marker-status");

    if (initial) initial.textContent = name.charAt(0).toUpperCase();
    if (nameEl) nameEl.textContent = name;
   if (statusEl) {
    statusEl.textContent = isMe
        ? "Siz · Online"
        : formatLastSeen(user.lastSeen, user.online);
}
    if (!isMe) {
        const hue = hueFromString(name);

        element.style.setProperty("--c1", `hsl(${hue} 72% 54%)`);
        element.style.setProperty("--c2", `hsl(${(hue + 40) % 360} 72% 42%)`);
    }
}

function createMarkerElement(user, isMe = false) {
    const element = document.createElement("div");

    element.className = isMe
        ? "gps-premium-marker gps-premium-marker-me"
        : "gps-premium-marker";

    element.innerHTML = `
        <div class="gps-marker-card">
            <div class="gps-marker-name"></div>
            <div class="gps-marker-status"></div>
        </div>

        <div class="gps-marker-dot">
            <span class="gps-marker-initial"></span>
            <i class="gps-marker-online"></i>
        </div>
    `;

    updateMarkerElement(element, user, isMe);

    element.addEventListener("click", event => {
        event.stopPropagation();

        const wasSelected = element.classList.contains(SELECTED_CLASS);

        clearSelectedMarkers();

        if (!wasSelected) element.classList.add(SELECTED_CLASS);
    });

    return element;
}

function updateMyMarker() {
    if (!mapInitialized || !map || typeof ymaps3 === "undefined") return;
    if (!validCoords(myLatitude, myLongitude)) return;

    const position = [myLongitude, myLatitude];

    const me = {
        id: currentUserId,
        name: currentUserName || "Siz",
        online: true
    };

    try {
        if (!myMarker) {
            const element = createMarkerElement(me, true);

            const marker = new ymaps3.YMapMarker({ coordinates: position }, element);

            map.addChild(marker);

            myMarker = { marker, element };
        } else {
            myMarker.marker.update({ coordinates: position });

            updateMarkerElement(myMarker.element, me, true);
        }

        /* Birinchi GPS kelganda xaritani o'zimizga markazlaymiz */
        if (!firstLocationCentered) {
            firstLocationCentered = true;

            setMapLocation({ center: position, zoom: 15, duration: 600 });
        }
    } catch (error) {
        console.error("My marker error:", error);
    }
}

function updateMapUsers() {
    if (!mapInitialized || !map || typeof ymaps3 === "undefined") return;

    const activeIds = new Set();

    users.forEach(user => {
        const id = String(user.id ?? "");

        if (!id || id === String(currentUserId)) return;

        if (!validCoords(user.lat, user.lng)) return;

        activeIds.add(id);

        /* Yandex Maps 3.0 tartibi: [longitude, latitude] */
        const position = [toCoord(user.lng), toCoord(user.lat)];

        try {
            const existing = userMarkers.get(id);

            if (existing) {
                existing.marker.update({ coordinates: position });

                updateMarkerElement(existing.element, user, false);
            } else {
                const element = createMarkerElement(user, false);

                const marker = new ymaps3.YMapMarker({ coordinates: position }, element);

                map.addChild(marker);

                userMarkers.set(id, { marker, element });
            }
        } catch (error) {
            console.error("User marker error:", error, user);
        }
    });

    /* Koordinatasi yo'q / ketgan foydalanuvchilar markerlarini tozalash */
    for (const [id, data] of userMarkers.entries()) {
        if (activeIds.has(id)) continue;

        try {
            map.removeChild(data.marker);
        } catch (error) { /* ignore */ }

        userMarkers.delete(id);
    }
}

function clearMapMarkers() {
    if (map && myMarker) {
        try {
            map.removeChild(myMarker.marker);
        } catch (error) { /* ignore */ }
    }

    myMarker = null;

    if (map) {
        for (const data of userMarkers.values()) {
            try {
                map.removeChild(data.marker);
            } catch (error) { /* ignore */ }
        }
    }

    userMarkers.clear();
}


/* =========================================================
   MAP CAMERA
   ========================================================= */

function setMapLocation(options = {}) {
    if (!map) return;

    try {
        const { center, zoom, bounds, duration = 500 } = options;

        const location = {};

        if (center) location.center = center;
        if (typeof zoom === "number") location.zoom = zoom;
        if (bounds) location.bounds = bounds;

        map.setLocation({
            ...location,
            duration
        });
    } catch (error) {
        console.error("Map location error:", error);
    }
}

function centerMapOnMe() {
    if (!map) {
        initMap().then(() => {
            if (map) centerMapOnMe();
        });

        return;
    }

    if (!validCoords(myLatitude, myLongitude)) {
        startLocationTracking();

        setLocationStatus("Joylashuv olinmoqda...", "connecting");

        return;
    }

    setMapLocation({
        center: [myLongitude, myLatitude],
        zoom: 16,
        duration: 500
    });
}

/* Butun guruhni bir ekranda ko'rsatish */
function fitGroup() {
    if (!map) {
        initMap().then(() => {
            if (map) fitGroup();
        });

        return;
    }

    const points = [];

    if (validCoords(myLatitude, myLongitude)) {
        points.push([myLongitude, myLatitude]);
    }

    users.forEach(user => {
        if (String(user.id) === String(currentUserId)) return;

        if (validCoords(user.lat, user.lng)) {
            points.push([toCoord(user.lng), toCoord(user.lat)]);
        }
    });

    if (points.length === 0) {
        centerMapOnMe();
        return;
    }

    if (points.length === 1) {
        setMapLocation({ center: points[0], zoom: 16, duration: 600 });
        return;
    }

    const lngs = points.map(p => p[0]);
    const lats = points.map(p => p[1]);

    const padLng = Math.max((Math.max(...lngs) - Math.min(...lngs)) * 0.2, 0.0008);
    const padLat = Math.max((Math.max(...lats) - Math.min(...lats)) * 0.2, 0.0008);

    setMapLocation({
        bounds: [
            [Math.min(...lngs) - padLng, Math.min(...lats) - padLat],
            [Math.max(...lngs) + padLng, Math.max(...lats) + padLat]
        ],
        duration: 700
    });
}

function centerMapOnUser(user) {
    if (!user) return;

    const me = String(user.id) === String(currentUserId);

    const lat = me ? myLatitude : toCoord(user.lat);
    const lng = me ? myLongitude : toCoord(user.lng);

    if (!validCoords(lat, lng)) {
        showRoomError("Bu foydalanuvchining joylashuvi hali mavjud emas.");

        setTimeout(() => clearError("roomError"), 2500);

        return;
    }

    if (!map) {
        initMap().then(() => {
            if (map) centerMapOnUser(user);
        });

        return;
    }

    setMapLocation({ center: [lng, lat], zoom: 16, duration: 650 });

    clearSelectedMarkers();

    const element = me
        ? myMarker?.element
        : userMarkers.get(String(user.id))?.element;

    element?.classList.add(SELECTED_CLASS);

    /* Mobil: xaritaga qaytish */
    $("map")?.scrollIntoView({ behavior: "smooth", block: "center" });
}


/* =========================================================
   COPY ROOM CODE
   ========================================================= */

async function copyRoomCode() {
    const code = normalizeRoomCode(currentRoomCode);

    if (!code) return;

    try {
        if (!navigator.clipboard?.writeText) {
            throw new Error("Clipboard API mavjud emas");
        }

        await navigator.clipboard.writeText(code);
    } catch (error) {
        const textarea = document.createElement("textarea");

        textarea.value = code;
        textarea.style.position = "fixed";
        textarea.style.opacity = "0";

        document.body.appendChild(textarea);

        textarea.select();

        try {
            document.execCommand("copy");
        } catch (copyError) { /* ignore */ }

        textarea.remove();
    }

    const text = $("copyRoomText");

    if (text) {
        const oldText = text.textContent;

        text.textContent = "Nusxalandi ✓";

        setTimeout(() => {
            text.textContent = oldText;
        }, 1500);
    }
}


/* =========================================================
   THEME
   ========================================================= */

function applyTheme(theme) {
    const dark = theme === "dark";

    document.documentElement.classList.toggle("dark", dark);
    document.body?.classList.toggle("dark", dark);

    store.set(THEME_KEY, theme);

    $("themeBtn")?.setAttribute(
        "aria-label",
        dark ? "Yorug‘ rejim" : "Tungi rejim"
    );

    const icon = $("themeIcon");

    if (icon) icon.textContent = dark ? "☀" : "☾";

    const meta = document.querySelector('meta[name="theme-color"]');

    if (meta) meta.setAttribute("content", dark ? "#060b09" : "#f4f8f6");

    /* Xarita ham mavzuga moslashadi */
    if (schemeLayer) {
        try {
            schemeLayer.update({ theme });
        } catch (error) { /* ignore */ }
    }
}

function toggleTheme() {
    applyTheme(getTheme() === "dark" ? "light" : "dark");
}

function initialTheme() {
    const saved = store.get(THEME_KEY);

    if (saved === "dark" || saved === "light") return saved;

    return window.matchMedia?.("(prefers-color-scheme: dark)").matches
        ? "dark"
        : "light";
}


/* =========================================================
   EVENTS
   ========================================================= */

function bindEnter(input, handler) {
    input?.addEventListener("keydown", event => {
        if (event.key === "Enter") {
            event.preventDefault();
            handler();
        }
    });
}

function setupEvents() {
    if (eventsInitialized) return;

    eventsInitialized = true;

    $("createRoomBtn")?.addEventListener("click", createRoom);
    $("joinRoomBtn")?.addEventListener("click", joinRoom);
    $("copyRoomBtn")?.addEventListener("click", copyRoomCode);
    $("switchRoomBtn")?.addEventListener("click", switchRoom);
    $("leaveGroupBtn")?.addEventListener("click", leaveGroup);
    $("themeBtn")?.addEventListener("click", toggleTheme);
    $("centerMapBtn")?.addEventListener("click", fitGroup);

    $("myLocationBtn")?.addEventListener("click", () => {
        startLocationTracking();
        centerMapOnMe();
    });

    $("savedGroupsList")?.addEventListener("click", onSavedGroupsClick);
    $("membersList")?.addEventListener("click", onMembersClick);

    /* Ism */
    const nameInput = $("userName");

    nameInput?.addEventListener("change", () => {
        persistName(cleanName(nameInput.value));

        if (currentRoomCode) sendName();
    });

    /* Guruh kodi */
    const roomInput = $("roomCode");

    roomInput?.addEventListener("input", () => {
        roomInput.value = normalizeRoomCode(roomInput.value);

        clearError("setupError");
    });

    bindEnter(roomInput, joinRoom);

    /* Boshqa guruhga o'tish */
    const switchInput = $("switchRoomInput");

    switchInput?.addEventListener("input", () => {
        switchInput.value = normalizeRoomCode(switchInput.value);

        clearError("roomError");
    });

    bindEnter(switchInput, switchRoom);

    /* Tarmoq / sahifa qaytganda qayta ulanish */
    document.addEventListener("visibilitychange", () => {
        if (!document.hidden) ensureConnected();
    });

    window.addEventListener("online", ensureConnected);
}


/* =========================================================
   MARKER & EXTRA STYLES
   ========================================================= */


function injectStyles() {
    if ($("live-gps-extra-style")) return;

    const style = document.createElement("style");
    style.id = "live-gps-extra-style";

    style.textContent = .member-last-seen-clock {
    margin-top: 3px;
    color: var(--muted, #7b8580);
    font-size: 10px;
    line-height: 1.4;
}

body.dark .member-last-seen-clock {
    color: #9ca9a1;
}

.gps-marker-status {
    max-width: 145px;
    overflow: hidden;
    text-overflow: ellipsis;
} `
.member-last-seen {
    margin-top: 4px;
    color: var(--muted, #7b8580);
    font-size: 11px;
    line-height: 1.4;
    overflow-wrap: anywhere;
}

body.dark .member-last-seen {
    color: #9ca9a1;
}

/* Status ranglari */
.connection-pill.connecting {
    color: #b7791f;
    background: rgba(245, 158, 11, .10);
    border-color: rgba(245, 158, 11, .20);
}

.connection-pill.error {
    color: #d93a3a;
    background: rgba(239, 68, 68, .09);
}

#connectionStatus.online,
#locationStatus.online { color: var(--green-dark); }

#connectionStatus.connecting,
#locationStatus.connecting { color: #b7791f; }

#connectionStatus.error,
#locationStatus.error,
#connectionStatus.offline,
#locationStatus.offline { color: var(--danger); }

body.dark #connectionStatus.online,
body.dark #locationStatus.online { color: #46eb91; }

/* Saqlangan guruhlar */
.saved-group-info {
    display: flex;
    flex-direction: column;
    gap: 3px;
    min-width: 0;
}

.saved-group-name {
    max-width: 220px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    color: var(--muted);
    font-size: 12px;
    font-weight: 600;
}

#savedGroupsList .saved-delete-btn {
    width: 38px;
    padding: 0;
    font-size: 19px;
    line-height: 1;
}

/* A'zolar */
.member { cursor: pointer; }

.member.me {
    border-color: rgba(25, 214, 107, .30);
    background: rgba(25, 214, 107, .05);
}

/* Xarita markerlari */
.gps-premium-marker {
    --c1: #4d88ff;
    --c2: #2f63d8;
    position: relative;
    width: 44px;
    height: 44px;
    display: flex;
    align-items: center;
    justify-content: center;
    transform: translate(-50%, -50%);
    cursor: pointer;
    font-family: Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
}

.gps-premium-marker-me {
    --c1: #19d66b;
    --c2: #0a9e50;
    z-index: 5;
}

.gps-marker-dot {
    position: relative;
    width: 38px;
    height: 38px;
    display: flex;
    align-items: center;
    justify-content: center;
    border: 3px solid #fff;
    border-radius: 50%;
    color: #fff;
    background: linear-gradient(145deg, var(--c1), var(--c2));
    box-shadow: 0 8px 22px rgba(0, 0, 0, .28);
    font-size: 15px;
    font-weight: 800;
    transition: transform .25s cubic-bezier(.22, .8, .3, 1);
}

.gps-premium-marker:hover .gps-marker-dot {
    transform: scale(1.1);
}

.gps-marker-dot::before {
    content: "";
    position: absolute;
    inset: -7px;
    border: 2px solid var(--c1);
    border-radius: 50%;
    opacity: 0;
    animation: gps-ring 2.2s ease-out infinite;
    pointer-events: none;
}

@keyframes gps-ring {
    0% { transform: scale(.7); opacity: .55; }
    100% { transform: scale(1.25); opacity: 0; }
}

.gps-marker-online {
    position: absolute;
    right: -4px;
    bottom: -4px;
    width: 13px;
    height: 13px;
    border: 2px solid #fff;
    border-radius: 50%;
    background: #22c55e;
    box-shadow: 0 0 10px rgba(34, 197, 94, .6);
}

.gps-premium-marker.offline .gps-marker-dot {
    opacity: .72;
    filter: grayscale(.85);
}

.gps-premium-marker.offline .gps-marker-dot::before {
    animation: none;
}

.gps-premium-marker.offline .gps-marker-online {
    background: #9ca3af;
    box-shadow: none;
}

.gps-marker-card {
    position: absolute;
    left: 50%;
    bottom: calc(100% + 6px);
    min-width: 84px;
    max-width: 170px;
    padding: 8px 13px;
    border: 1px solid rgba(255, 255, 255, .9);
    border-radius: 14px;
    background: rgba(255, 255, 255, .97);
    box-shadow: 0 10px 32px rgba(0, 0, 0, .20), 0 3px 10px rgba(0, 0, 0, .10);
    text-align: center;
    white-space: nowrap;
    opacity: 0;
    visibility: hidden;
    pointer-events: none;
    transform: translateX(-50%) translateY(6px) scale(.94);
    transition: opacity .2s ease, transform .2s ease, visibility .2s ease;
}

.gps-marker-card::after {
    content: "";
    position: absolute;
    left: 50%;
    bottom: -5px;
    width: 10px;
    height: 10px;
    background: inherit;
    border-radius: 2px;
    transform: translateX(-50%) rotate(45deg);
}

.gps-marker-selected .gps-marker-card {
    opacity: 1;
    visibility: visible;
    pointer-events: auto;
    transform: translateX(-50%) translateY(0) scale(1);
}

.gps-marker-name {
    overflow: hidden;
    text-overflow: ellipsis;
    color: #17201c;
    font-size: 13px;
    font-weight: 750;
    line-height: 1.2;
}

.gps-marker-status {
    margin-top: 3px;
    color: #647067;
    font-size: 10px;
    font-weight: 600;
    line-height: 1;
}

body.dark .gps-marker-card {
    border-color: rgba(255, 255, 255, .10);
    background: rgba(25, 31, 28, .97);
    box-shadow: 0 12px 40px rgba(0, 0, 0, .45);
}

body.dark .gps-marker-name { color: #f3f7f5; }
body.dark .gps-marker-status { color: #9ca9a1; }

@media (max-width: 600px) {
    .gps-premium-marker { width: 40px; height: 40px; }
    .gps-marker-dot { width: 34px; height: 34px; font-size: 14px; }
    .gps-marker-name { font-size: 12px; }
}

@media (prefers-reduced-motion: reduce) {
    .gps-marker-dot::before { animation: none; }
}
`;

    document.head.appendChild(style);
}

/* =========================================================
   DEBUG
   ========================================================= */

window.GPS_DEBUG = {
    getState() {
        return {
            currentUserId,
            currentUserName,
            currentRoomCode,
            lastRoomCode: store.get(LAST_ROOM_KEY),
            pendingAction,
            pendingActionSent,
            connected: !!(ws && ws.readyState === WebSocket.OPEN),
            users,
            savedGroups,
            mapInitialized,
            myLocation: {
                lat: myLatitude,
                lng: myLongitude,
                accuracy: myAccuracy
            }
        };
    },

    reconnect() {
        manuallyClosed = false;
        pendingActionSent = false;

        connectWebSocket();
    },

    clearSession() {
        [USER_ID_KEY, USER_NAME_KEY, ROOM_CODE_KEY, LAST_ROOM_KEY].forEach(store.remove);

        location.reload();
    }
};


/* =========================================================
   START
   ========================================================= */

document.addEventListener("DOMContentLoaded", () => {
    applyTheme(initialTheme());

    injectStyles();
    setupEvents();
  setInterval(() => {
    if (users.length > 0) {
        renderUsers();
        updateMapUsers();
    }
}, 10_000);
    restoreSession();
});
