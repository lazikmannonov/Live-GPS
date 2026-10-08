"use strict";

/* =========================================================
   LIVE GPS — YANDEX MAPS 3.0
   server.js ga tegilmaydi
   ========================================================= */

/*
 * WebSocket server manzili.
 *
 * HTTPS sayt bo‘lsa:
 *    wss://
 *
 * HTTP bo‘lsa:
 *    ws://
 */

const WS_URL =
    location.protocol === "https:"
        ? `wss://${location.host}`
        : `ws://${location.host}`;


/* =========================================================
   STATE
   ========================================================= */

const state = {
    ws: null,

    userId:
        localStorage.getItem("livegps_user_id") ||
        `user_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,

    userName:
        localStorage.getItem("livegps_user_name") || "",

    roomCode:
        localStorage.getItem("livegps_room_code") || "",

    connected: false,
    reconnectTimer: null,
    reconnectAttempts: 0,

    gpsWatchId: null,
    currentPosition: null,

    map: null,
    yandexReady: false,
    mapReady: false,

    markers: new Map(),
    users: new Map(),

    firstGpsFix: false,

    theme:
        localStorage.getItem("livegps_theme") ||
        "dark"
};
/* =========================================================
   YANDEX MAPS 3.0 LOADER
   ========================================================= */

async function loadYandexMaps() {
    try {
        /*
         * Yandex API index.html ichida yuklanadi.
         *
         * Script async tarzda yuklanishi mumkin, shuning uchun
         * ymaps3 darhol mavjud bo‘lmasligi mumkin.
         *
         * Shu yerda 15 soniyagacha kutamiz.
         */

        const maxWait = 15000;
        const interval = 100;
        const startTime = Date.now();

        while (
            typeof ymaps3 === "undefined" &&
            Date.now() - startTime < maxWait
        ) {
            await new Promise(resolve => {
                setTimeout(resolve, interval);
            });
        }

        /*
         * 15 soniyadan keyin ham ymaps3 bo‘lmasa,
         * API yuklanmagan hisoblanadi.
         */

        if (typeof ymaps3 === "undefined") {
            throw new Error(
                "Yandex Maps API yuklanmadi. index.html dagi API key yoki HTTP Referer sozlamasini tekshiring."
            );
        }

        /*
         * Yandex Maps 3.0 to‘liq tayyor bo‘lishini kutamiz.
         */

        await ymaps3.ready;

        state.yandexReady = true;

        console.log(
            "YANDEX MAPS: ready"
        );

        return true;

    } catch (error) {

        state.yandexReady = false;

        console.error(
            "YANDEX MAPS ERROR:",
            error
        );

        throw error;
    }
}

/* =========================================================
   SAVE SESSION
   ========================================================= */

localStorage.setItem("livegps_user_id", state.userId);

function saveSession() {
    localStorage.setItem("livegps_user_id", state.userId);

    if (state.userName) {
        localStorage.setItem("livegps_user_name", state.userName);
    }

    if (state.roomCode) {
        localStorage.setItem("livegps_room_code", state.roomCode);
    }
}

function clearRoomSession() {
    state.roomCode = "";
    localStorage.removeItem("livegps_room_code");
}


/* =========================================================
   DOM HELPERS
   ========================================================= */

function $(id) {
    return document.getElementById(id);
}

function setText(id, value) {
    const el = $(id);
    if (el) {
        el.textContent = value;
    }
}

function showElement(id, show) {
    const el = $(id);
    if (!el) return;

    el.style.display = show ? "" : "none";
}

function escapeHTML(value) {
    return String(value ?? "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
}

function normalizeRoomCode(value) {
    return String(value || "")
        .trim()
        .toUpperCase()
        .replace(/[^A-Z0-9_-]/g, "");
}


/* =========================================================
   ERRORS
   ========================================================= */

function setSetupError(message = "") {
    const el = $("setupError");

    if (!el) return;

    el.textContent = message;
    el.style.display = message ? "block" : "none";
}

function setRoomError(message = "") {
    const el = $("roomError");

    if (!el) return;

    el.textContent = message;
    el.style.display = message ? "block" : "none";
}


/* =========================================================
   CONNECTION STATUS
   ========================================================= */

function updateConnectionStatus(status, text) {
    setText("connectionText", text);

    const pill = $("connectionPill");

    if (pill) {
        pill.classList.remove(
            "online",
            "offline",
            "connecting"
        );

        pill.classList.add(status);
    }

    const statusEl = $("connectionStatus");

    if (statusEl) {
        statusEl.textContent = text;
    }
}


/* =========================================================
   LOCATION STATUS
   ========================================================= */

function updateLocationStatus(status, text) {
    const el = $("locationStatus");

    if (!el) return;

    el.textContent = text;

    el.classList.remove(
        "active",
        "error",
        "waiting"
    );

    if (status) {
        el.classList.add(status);
    }
}


/* =========================================================
   UI
   ========================================================= */

function showSetup() {
    showElement("setupCard", true);
    showElement("roomCard", false);
}

function showRoom() {
    showElement("setupCard", false);
    showElement("roomCard", true);

    updateRoomCodeUI();
}

function updateRoomCodeUI() {
    setText(
        "currentRoomCode",
        state.roomCode || "—"
    );
}


/* =========================================================
   YANDEX MAPS 3.0 LOADER
   ========================================================= */

async function loadYandexMaps() {
    try {
        if (typeof ymaps3 === "undefined") {
            throw new Error(
                "Yandex Maps API topilmadi. index.html dagi API keyni tekshiring."
            );
        }

        await ymaps3.ready;

        state.yandexReady = true;

        console.log("YANDEX MAPS: ready");

        return true;
    } catch (error) {
        state.yandexReady = false;

        console.error(
            "YANDEX MAPS ERROR:",
            error
        );

        throw error;
    }
}


/* =========================================================
   MAP INIT
   ========================================================= */

async function initMap() {
    try {
        await loadYandexMaps();

        if (state.map) {
            return;
        }

        const mapContainer = $("map");

        if (!mapContainer) {
            throw new Error(
                "Map container topilmadi."
            );
        }

        const {
            YMap,
            YMapDefaultSchemeLayer,
            YMapDefaultFeaturesLayer
        } = ymaps3;

        state.map = new YMap(
            mapContainer,
            {
                location: {
                    center: [
                        69.2401,
                        41.2995
                    ],
                    zoom: 12
                },

                behaviors: [
                    "drag",
                    "pinchZoom",
                    "dblClick",
                    "mouseTilt"
                ]
            }
        );

        state.map.addChild(
            new YMapDefaultSchemeLayer()
        );

        state.map.addChild(
            new YMapDefaultFeaturesLayer()
        );

        state.mapReady = true;

        console.log(
            "YANDEX MAP: initialized"
        );

        if (state.currentPosition) {
            centerMap(
                state.currentPosition.lng,
                state.currentPosition.lat,
                18
            );
        }

        renderMarkers();

    } catch (error) {
        state.mapReady = false;

        console.error(
            "YANDEX MAP ERROR:",
            error
        );

        setRoomError(
            "Xarita yuklanmadi. Yandex API key va HTTP Referer sozlamalarini tekshiring."
        );
    }
}


/* =========================================================
   MAP CENTER
   ========================================================= */

function centerMap(lng, lat, zoom = 17) {
    if (!state.map) return;

    try {
        state.map.setLocation({
            center: [
                Number(lng),
                Number(lat)
            ],
            zoom
        });
    } catch (error) {
        console.error(
            "MAP CENTER ERROR:",
            error
        );
    }
}


/* =========================================================
   CREATE MARKER ELEMENT
   ========================================================= */

function createMarkerElement(user) {
    const wrapper =
        document.createElement("div");

    wrapper.className = "gps-marker";

    const avatar =
        document.createElement("div");

    avatar.className = "gps-marker-avatar";

    const name =
        String(
            user.name ||
            user.userName ||
            "?"
        ).trim();

    avatar.textContent =
        name.charAt(0).toUpperCase() || "?";

    const label =
        document.createElement("div");

    label.className = "gps-marker-label";

    label.textContent =
        user.name ||
        user.userName ||
        "Foydalanuvchi";

    wrapper.appendChild(avatar);
    wrapper.appendChild(label);

    return wrapper;
}


/* =========================================================
   REMOVE MARKER
   ========================================================= */

function removeMarker(userId) {
    const marker =
        state.markers.get(userId);

    if (!marker || !state.map) {
        return;
    }

    try {
        state.map.removeChild(marker);
    } catch (error) {
        console.warn(
            "Marker remove error:",
            error
        );
    }

    state.markers.delete(userId);
}


/* =========================================================
   RENDER MARKERS
   ========================================================= */

function renderMarkers() {
    if (!state.mapReady || !state.map) {
        return;
    }

    const {
        YMapMarker
    } = ymaps3;

    const activeIds = new Set();

    state.users.forEach((user, userId) => {
        if (
            user.lat === undefined ||
            user.lng === undefined ||
            user.lat === null ||
            user.lng === null
        ) {
            return;
        }

        const lat = Number(user.lat);
        const lng = Number(user.lng);

        if (
            !Number.isFinite(lat) ||
            !Number.isFinite(lng)
        ) {
            return;
        }

        activeIds.add(userId);

        // Eski markerni olib tashlaymiz.
        // Yandex Maps 3.0 da DOM elementni shunchaki
        // almashtirish o‘rniga markerni qayta yaratish ishonchliroq.
        if (state.markers.has(userId)) {
            removeMarker(userId);
        }

        const element =
            createMarkerElement(user);

        const marker =
            new YMapMarker(
                {
                    coordinates: [
                        lng,
                        lat
                    ]
                },
                element
            );

        state.map.addChild(marker);

        state.markers.set(
            userId,
            marker
        );
    });

    // Xonadan chiqqan foydalanuvchilarning markerlarini o‘chirish
    state.markers.forEach(
        (marker, userId) => {
            if (!activeIds.has(userId)) {
                removeMarker(userId);
            }
        }
    );
}


/* =========================================================
   MY LOCATION
   ========================================================= */

function centerMyLocation() {
    if (!state.currentPosition) {
        updateLocationStatus(
            "waiting",
            "Joylashuv hali aniqlanmadi"
        );
        return;
    }

    centerMap(
        state.currentPosition.lng,
        state.currentPosition.lat,
        18
    );
}

function centerAllUsers() {
    const positions = [];

    state.users.forEach(user => {
        if (
            user.lat !== undefined &&
            user.lng !== undefined &&
            Number.isFinite(Number(user.lat)) &&
            Number.isFinite(Number(user.lng))
        ) {
            positions.push([
                Number(user.lng),
                Number(user.lat)
            ]);
        }
    });

    if (!positions.length) {
        centerMyLocation();
        return;
    }

    if (positions.length === 1) {
        centerMap(
            positions[0][0],
            positions[0][1],
            17
        );
        return;
    }

    const lngs =
        positions.map(p => p[0]);

    const lats =
        positions.map(p => p[1]);

    const minLng = Math.min(...lngs);
    const maxLng = Math.max(...lngs);

    const minLat = Math.min(...lats);
    const maxLat = Math.max(...lats);

    const centerLng =
        (minLng + maxLng) / 2;

    const centerLat =
        (minLat + maxLat) / 2;

    let zoom = 14;

    const spread =
        Math.max(
            maxLng - minLng,
            maxLat - minLat
        );

    if (spread < 0.001) {
        zoom = 17;
    } else if (spread < 0.005) {
        zoom = 15;
    } else if (spread < 0.02) {
        zoom = 13;
    } else if (spread < 0.1) {
        zoom = 11;
    } else {
        zoom = 9;
    }

    centerMap(
        centerLng,
        centerLat,
        zoom
    );
}


/* =========================================================
   MEMBERS
   ========================================================= */

function updateMembersUI() {
    const users =
        Array.from(state.users.values());

    setText(
        "membersCount",
        String(users.length)
    );

    const list =
        $("membersList");

    if (!list) return;

    if (!users.length) {
        list.innerHTML =
            `<div class="empty-members">
                Hozircha foydalanuvchilar yo‘q
            </div>`;

        return;
    }

    list.innerHTML =
        users.map(user => {
            const name =
                escapeHTML(
                    user.name ||
                    user.userName ||
                    "Foydalanuvchi"
                );

            const isMe =
                String(
                    user.id ||
                    user.userId
                ) === String(state.userId);

            return `
                <div class="member-item">
                    <div class="member-avatar">
                        ${name.charAt(0).toUpperCase()}
                    </div>

                    <div class="member-info">
                        <div class="member-name">
                            ${name}
                            ${isMe ? " <span>(siz)</span>" : ""}
                        </div>

                        <div class="member-status">
                            ${user.lat != null ? "● Online" : "○ Joylashuv yo‘q"}
                        </div>
                    </div>
                </div>
            `;
        }).join("");
}


/* =========================================================
   GPS
   ========================================================= */

function startLocationTracking() {
    if (!navigator.geolocation) {
        updateLocationStatus(
            "error",
            "Brauzeringiz GPSni qo‘llab-quvvatlamaydi"
        );
        return;
    }

    if (state.gpsWatchId !== null) {
        return;
    }

    updateLocationStatus(
        "waiting",
        "Joylashuv aniqlanmoqda..."
    );

    state.gpsWatchId =
        navigator.geolocation.watchPosition(
            handlePosition,
            handleLocationError,
            {
                enableHighAccuracy: true,
                maximumAge: 2000,
                timeout: 15000
            }
        );
}

function stopLocationTracking() {
    if (
        state.gpsWatchId !== null &&
        navigator.geolocation
    ) {
        navigator.geolocation.clearWatch(
            state.gpsWatchId
        );

        state.gpsWatchId = null;
    }
}

function handlePosition(position) {
    const lat =
        Number(position.coords.latitude);

    const lng =
        Number(position.coords.longitude);

    const accuracy =
        Number(position.coords.accuracy);

    if (
        !Number.isFinite(lat) ||
        !Number.isFinite(lng)
    ) {
        return;
    }

    state.currentPosition = {
        lat,
        lng,
        accuracy
    };

    updateLocationStatus(
        "active",
        `Joylashuv aniqlandi ±${Math.round(accuracy)} m`
    );

    // Xarita tayyor bo‘lsa, birinchi GPS nuqtasida markazlash
    if (
        state.mapReady &&
        !state.firstGpsFix
    ) {
        centerMap(
            lng,
            lat,
            18
        );

        state.firstGpsFix = true;
    }

    // O‘zimizning foydalanuvchini state ichida yangilaymiz
    const currentUser =
        state.users.get(state.userId) || {
            id: state.userId,
            userId: state.userId,
            name: state.userName
        };

    currentUser.id =
        currentUser.id || state.userId;

    currentUser.userId =
        currentUser.userId || state.userId;

    currentUser.name =
        currentUser.name || state.userName;

    currentUser.lat = lat;
    currentUser.lng = lng;
    currentUser.accuracy = accuracy;

    state.users.set(
        state.userId,
        currentUser
    );

    updateMembersUI();
    renderMarkers();

    // Serverga yuborish
    sendLocation(
        lat,
        lng,
        accuracy
    );
}

function handleLocationError(error) {
    console.error(
        "GPS ERROR:",
        error
    );

    let message =
        "Joylashuvni aniqlab bo‘lmadi";

    if (error.code === 1) {
        message =
            "GPS uchun ruxsat berilmagan";
    } else if (error.code === 2) {
        message =
            "Joylashuv aniqlanmadi";
    } else if (error.code === 3) {
        message =
            "GPS so‘rovi vaqt tugadi";
    }

    updateLocationStatus(
        "error",
        message
    );
}


/* =========================================================
   WEBSOCKET SEND
   ========================================================= */

function sendMessage(payload) {
    if (
        !state.ws ||
        state.ws.readyState !== WebSocket.OPEN
    ) {
        return false;
    }

    try {
        state.ws.send(
            JSON.stringify(payload)
        );

        return true;
    } catch (error) {
        console.error(
            "WS SEND ERROR:",
            error
        );

        return false;
    }
}

function sendLocation(
    lat,
    lng,
    accuracy
) {
    sendMessage({
        type: "location",
        lat,
        lng,
        accuracy
    });
}


/* =========================================================
   WEBSOCKET CONNECT
   ========================================================= */

function connectWebSocket() {
    if (
        state.ws &&
        (
            state.ws.readyState === WebSocket.OPEN ||
            state.ws.readyState === WebSocket.CONNECTING
        )
    ) {
        return;
    }

    updateConnectionStatus(
        "connecting",
        "Ulanmoqda..."
    );

    try {
        state.ws =
            new WebSocket(WS_URL);
    } catch (error) {
        console.error(
            "WEBSOCKET CREATE ERROR:",
            error
        );

        scheduleReconnect();

        return;
    }

    state.ws.onopen = () => {
        console.log(
            "SERVER: connected"
        );

        state.connected = true;
        state.reconnectAttempts = 0;

        updateConnectionStatus(
            "online",
            "Ulangan"
        );

        sendMessage({
            type: "identify",
            userId: state.userId,
            name: state.userName
        });

        if (state.roomCode) {
            sendMessage({
                type: "join-room",
                roomCode: state.roomCode
            });
        }
    };

    state.ws.onmessage = event => {
        handleServerMessage(event.data);
    };

    state.ws.onerror = error => {
        console.error(
            "SERVER ERROR:",
            error
        );
    };

    state.ws.onclose = () => {
        console.log(
            "SERVER: disconnected"
        );

        state.connected = false;

        updateConnectionStatus(
            "offline",
            "Ulanish uzildi"
        );

        scheduleReconnect();
    };
}


/* =========================================================
   RECONNECT
   ========================================================= */

function scheduleReconnect() {
    if (state.reconnectTimer) {
        return;
    }

    state.reconnectAttempts++;

    const delay =
        Math.min(
            1000 *
            Math.pow(
                1.5,
                Math.min(
                    state.reconnectAttempts,
                    8
                )
            ),
            15000
        );

    state.reconnectTimer =
        setTimeout(() => {
            state.reconnectTimer = null;
            connectWebSocket();
        }, delay);
}


/* =========================================================
   SERVER MESSAGES
   ========================================================= */

function handleServerMessage(raw) {
    let data;

    try {
        data =
            typeof raw === "string"
                ? JSON.parse(raw)
                : raw;
    } catch (error) {
        console.error(
            "SERVER JSON ERROR:",
            error
        );

        return;
    }

    console.log(
        "SERVER:",
        data
    );

    const type =
        data.type ||
        data.event;

    switch (type) {
        case "connected":
            break;

        case "room-created":
            handleRoomCreated(data);
            break;

        case "joined-room":
            handleJoinedRoom(data);
            break;

        case "users":
            handleUsers(data);
            break;

        case "left-room":
            handleLeftRoom(data);
            break;

        case "error":
            handleServerError(data);
            break;

        default:
            console.log(
                "UNKNOWN SERVER MESSAGE:",
                data
            );
    }
}


/* =========================================================
   ROOM CREATED
   ========================================================= */

function handleRoomCreated(data) {
    const room =
        normalizeRoomCode(
            data.roomCode ||
            data.code ||
            data.room
        );

    if (!room) {
        return;
    }

    state.roomCode = room;

    saveSession();
    updateRoomCodeUI();
    showRoom();

    setRoomError("");

    startLocationTracking();
}


/* =========================================================
   JOINED ROOM
   ========================================================= */

function handleJoinedRoom(data) {
    const room =
        normalizeRoomCode(
            data.roomCode ||
            data.code ||
            data.room ||
            state.roomCode
        );

    if (room) {
        state.roomCode = room;
        saveSession();
    }

    updateRoomCodeUI();
    showRoom();

    setRoomError("");

    console.log(
        "joined-room",
        data
    );

    startLocationTracking();
}


/* =========================================================
   USERS
   ========================================================= */

function handleUsers(data) {
    const list =
        Array.isArray(data.users)
            ? data.users
            : [];

    state.users.clear();

    list.forEach(user => {
        const id =
            user.id ||
            user.userId;

        if (!id) {
            return;
        }

        state.users.set(
            String(id),
            {
                ...user,
                id: String(id),
                userId: String(
                    user.userId || id
                )
            }
        );
    });

    // Agar server foydalanuvchini qaytarmagan bo‘lsa,
    // o‘z GPS ma'lumotimizni saqlab qolamiz.
    if (
        state.currentPosition &&
        !state.users.has(state.userId)
    ) {
        state.users.set(
            state.userId,
            {
                id: state.userId,
                userId: state.userId,
                name: state.userName,
                lat: state.currentPosition.lat,
                lng: state.currentPosition.lng,
                accuracy: state.currentPosition.accuracy
            }
        );
    }

    updateMembersUI();
    renderMarkers();

    console.log(
        "users",
        Array.from(state.users.values())
    );
}


/* =========================================================
   LEFT ROOM
   ========================================================= */

function handleLeftRoom(data) {
    const id =
        data.userId ||
        data.id;

    if (id) {
        state.users.delete(
            String(id)
        );

        removeMarker(
            String(id)
        );
    }

    updateMembersUI();
    renderMarkers();
}


/* =========================================================
   SERVER ERROR
   ========================================================= */

function handleServerError(data) {
    const message =
        data.message ||
        data.error ||
        "Server xatosi";

    console.error(
        "SERVER ERROR:",
        message
    );

    setRoomError(
        message
    );

    // Guruh topilmasa, noto‘g‘ri saqlangan
    // session sababli qayta-qayta xato chiqmasin.
    if (
        /guruh topilmadi|room not found|room.*not found/i.test(
            message
        )
    ) {
        clearRoomSession();
        state.users.clear();

        state.markers.forEach(
            (_, id) => removeMarker(id)
        );

        updateMembersUI();
        updateRoomCodeUI();
    }
}


/* =========================================================
   CREATE ROOM
   ========================================================= */

function createRoom() {
    setSetupError("");

    const nameInput =
        $("userName");

    const name =
        String(
            nameInput?.value || ""
        ).trim();

    if (!name) {
        setSetupError(
            "Iltimos, ismingizni kiriting."
        );

        nameInput?.focus();

        return;
    }

    state.userName = name;

    saveSession();

    if (
        !state.ws ||
        state.ws.readyState !== WebSocket.OPEN
    ) {
        setSetupError(
            "Serverga ulanish kutilmoqda..."
        );

        connectWebSocket();

        return;
    }

    sendMessage({
        type: "create-room",
        name: state.userName,
        userId: state.userId
    });
}


/* =========================================================
   JOIN ROOM
   ========================================================= */

function joinRoom() {
    setSetupError("");

    const nameInput =
        $("userName");

    const roomInput =
        $("roomCode");

    const name =
        String(
            nameInput?.value || ""
        ).trim();

    const room =
        normalizeRoomCode(
            roomInput?.value
        );

    if (!name) {
        setSetupError(
            "Iltimos, ismingizni kiriting."
        );

        nameInput?.focus();

        return;
    }

    if (!room) {
        setSetupError(
            "Guruh kodini kiriting."
        );

        roomInput?.focus();

        return;
    }

    state.userName = name;
    state.roomCode = room;

    saveSession();

    if (
        !state.ws ||
        state.ws.readyState !== WebSocket.OPEN
    ) {
        setSetupError(
            "Serverga ulanish kutilmoqda..."
        );

        connectWebSocket();

        return;
    }

    sendMessage({
        type: "join-room",
        roomCode: room,
        name: state.userName,
        userId: state.userId
    });
}


/* =========================================================
   SWITCH ROOM
   ========================================================= */

function switchRoom() {
    setRoomError("");

    const input =
        $("switchRoomInput");

    const room =
        normalizeRoomCode(
            input?.value
        );

    if (!room) {
        setRoomError(
            "Yangi guruh kodini kiriting."
        );

        input?.focus();

        return;
    }

    state.users.clear();

    state.markers.forEach(
        (_, id) => removeMarker(id)
    );

    state.roomCode = room;

    saveSession();

    updateRoomCodeUI();

    sendMessage({
        type: "join-room",
        roomCode: room
    });

    if (input) {
        input.value = "";
    }
}


/* =========================================================
   COPY ROOM CODE
   ========================================================= */

async function copyRoomCode() {
    const code =
        state.roomCode;

    if (!code) {
        return;
    }

    try {
        await navigator.clipboard.writeText(
            code
        );

        setText(
            "copyRoomText",
            "Nusxalandi!"
        );

        setTimeout(() => {
            setText(
                "copyRoomText",
                "Nusxalash"
            );
        }, 1500);

    } catch (error) {
        console.error(
            "COPY ERROR:",
            error
        );

        setText(
            "copyRoomText",
            code
        );
    }
}


/* =========================================================
   THEME
   ========================================================= */

function applyTheme() {
    document.documentElement.dataset.theme =
        state.theme;

    document.body.classList.toggle(
        "dark",
        state.theme === "dark"
    );

    localStorage.setItem(
        "livegps_theme",
        state.theme
    );

    const icon =
        $("themeIcon");

    if (icon) {
        icon.textContent =
            state.theme === "dark"
                ? "☀️"
                : "🌙";
    }
}

function toggleTheme() {
    state.theme =
        state.theme === "dark"
            ? "light"
            : "dark";

    applyTheme();
}


/* =========================================================
   RESTORE SESSION
   ========================================================= */

function restoreSession() {
    const name =
        localStorage.getItem(
            "livegps_user_name"
        );

    const room =
        localStorage.getItem(
            "livegps_room_code"
        );

    if (name) {
        state.userName = name;

        const input =
            $("userName");

        if (input) {
            input.value = name;
        }
    }

    if (room) {
        state.roomCode =
            normalizeRoomCode(room);
    }

    if (
        state.userName &&
        state.roomCode
    ) {
        showRoom();
    } else {
        showSetup();
    }
}


/* =========================================================
   EVENT SETUP
   ========================================================= */

function setupEvents() {
    const createBtn =
        $("createRoomBtn");

    if (createBtn) {
        createBtn.addEventListener(
            "click",
            createRoom
        );
    }

    const joinBtn =
        $("joinRoomBtn");

    if (joinBtn) {
        joinBtn.addEventListener(
            "click",
            joinRoom
        );
    }

    const copyBtn =
        $("copyRoomBtn");

    if (copyBtn) {
        copyBtn.addEventListener(
            "click",
            copyRoomCode
        );
    }

    const switchBtn =
        $("switchRoomBtn");

    if (switchBtn) {
        switchBtn.addEventListener(
            "click",
            switchRoom
        );
    }

    const myLocationBtn =
        $("myLocationBtn");

    if (myLocationBtn) {
        myLocationBtn.addEventListener(
            "click",
            centerMyLocation
        );
    }

    const centerMapBtn =
        $("centerMapBtn");

    if (centerMapBtn) {
        centerMapBtn.addEventListener(
            "click",
            centerAllUsers
        );
    }

    const themeBtn =
        $("themeBtn");

    if (themeBtn) {
        themeBtn.addEventListener(
            "click",
            toggleTheme
        );
    }

    const roomInput =
        $("roomCode");

    if (roomInput) {
        roomInput.addEventListener(
            "keydown",
            event => {
                if (event.key === "Enter") {
                    joinRoom();
                }
            }
        );
    }

    const switchInput =
        $("switchRoomInput");

    if (switchInput) {
        switchInput.addEventListener(
            "keydown",
            event => {
                if (event.key === "Enter") {
                    switchRoom();
                }
            }
        );
    }
}


/* =========================================================
   WINDOW FUNCTIONS
   ========================================================= */

window.createRoom =
    createRoom;

window.joinRoom =
    joinRoom;

window.switchRoom =
    switchRoom;

window.copyRoomCode =
    copyRoomCode;

window.centerMyLocation =
    centerMyLocation;

window.centerAllUsers =
    centerAllUsers;

window.toggleTheme =
    toggleTheme;


/* =========================================================
   INIT
   ========================================================= */

async function init() {
    console.log(
        "LIVE GPS: starting..."
    );

    applyTheme();

    restoreSession();

    setupEvents();

    // Xarita alohida ishga tushadi.
    // WebSocket va GPS bunga bog‘lanib qolmaydi.
    await initMap();

    updateConnectionStatus(
        "connecting",
        "Serverga ulanmoqda..."
    );

    connectWebSocket();

    if (
        state.userName &&
        state.roomCode
    ) {
        startLocationTracking();
    }
}


/* =========================================================
   PAGE LOAD
   ========================================================= */

if (
    document.readyState ===
    "loading"
) {
    document.addEventListener(
        "DOMContentLoaded",
        init
    );
} else {
    init();
}


/* =========================================================
   BEFORE UNLOAD
   ========================================================= */

window.addEventListener(
    "beforeunload",
    () => {
        stopLocationTracking();

        if (
            state.ws &&
            state.ws.readyState === WebSocket.OPEN
        ) {
            try {
                state.ws.close();
            } catch (_) {}
        }
    }
);
