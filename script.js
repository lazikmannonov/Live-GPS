"use strict";

/* =========================================================
   LIVE GPS — SCRIPT.JS
   HTML bilan to'liq moslangan versiya
   ========================================================= */

const STORAGE = {
    USER_ID: "livegps_user_id",
    USER_NAME: "livegps_user_name",
    ROOM_CODE: "livegps_room_code",
    SAVED_GROUPS: "livegps_saved_groups",
    THEME: "livegps_theme"
};

const state = {
    ws: null,
    userId: localStorage.getItem(STORAGE.USER_ID) || "",
    userName: localStorage.getItem(STORAGE.USER_NAME) || "",
    roomCode: localStorage.getItem(STORAGE.ROOM_CODE) || "",

    connected: false,
    connecting: false,
    joining: false,

    reconnectTimer: null,
    reconnectDelay: 1000,

    locationWatchId: null,
    currentPosition: null,

    map: null,
    markers: new Map(),
    accuracyCircles: new Map(),

    users: [],

    pendingAction: null,
    pendingRoomCode: null,

    initialized: false
};


/* =========================================================
   DOM
   ========================================================= */

let els = {};


function cacheDom() {
    els = {
        setupCard: document.getElementById("setupCard"),
        roomCard: document.getElementById("roomCard"),

        userName: document.getElementById("userName"),
        roomCode: document.getElementById("roomCode"),

        createRoomBtn: document.getElementById("createRoomBtn"),
        joinRoomBtn: document.getElementById("joinRoomBtn"),

        setupError: document.getElementById("setupError"),
        roomError: document.getElementById("roomError"),

        currentRoomCode: document.getElementById("currentRoomCode"),
        copyRoomBtn: document.getElementById("copyRoomBtn"),
        copyRoomText: document.getElementById("copyRoomText"),

        connectionStatus: document.getElementById("connectionStatus"),
        locationStatus: document.getElementById("locationStatus"),

        membersCount: document.getElementById("membersCount"),
        membersList: document.getElementById("membersList"),

        switchRoomInput: document.getElementById("switchRoomInput"),
        switchRoomBtn: document.getElementById("switchRoomBtn"),

        map: document.getElementById("map"),
        myLocationBtn: document.getElementById("myLocationBtn"),
        centerMapBtn: document.getElementById("centerMapBtn"),

        connectionPill: document.getElementById("connectionPill"),
        connectionText: document.getElementById("connectionText"),

        themeBtn: document.getElementById("themeBtn"),
        themeIcon: document.getElementById("themeIcon")
    };
}


/* =========================================================
   INIT
   ========================================================= */

document.addEventListener("DOMContentLoaded", () => {
    cacheDom();

    loadSavedForm();
    initTheme();
    initMap();
    initEvents();
    renderSavedGroups();

    state.initialized = true;

    connectWebSocket();
});


/* =========================================================
   FORM
   ========================================================= */

function loadSavedForm() {
    if (els.userName) {
        els.userName.value = state.userName;
    }

    if (els.roomCode) {
        els.roomCode.value = state.roomCode;
    }

    if (els.switchRoomInput && state.roomCode) {
        els.switchRoomInput.value = state.roomCode;
    }
}


function getName() {
    const name = String(
        els.userName?.value ||
        state.userName ||
        ""
    )
        .trim()
        .slice(0, 30);

    return name;
}


function normalizeRoomCode(value) {
    return String(value || "")
        .trim()
        .toUpperCase()
        .replace(/[^A-Z0-9]/g, "")
        .slice(0, 6);
}


function saveUserName(name) {
    state.userName = name;
    localStorage.setItem(STORAGE.USER_NAME, name);
}


function saveRoomCode(code) {
    state.roomCode = code;
    localStorage.setItem(STORAGE.ROOM_CODE, code);
}


function saveUserId(id) {
    if (!id) return;

    state.userId = String(id).trim();

    localStorage.setItem(
        STORAGE.USER_ID,
        state.userId
    );
}


/* =========================================================
   EVENTS
   ========================================================= */

function initEvents() {

    els.createRoomBtn?.addEventListener(
        "click",
        createRoom
    );

    els.joinRoomBtn?.addEventListener(
        "click",
        joinRoom
    );

    els.copyRoomBtn?.addEventListener(
        "click",
        copyRoomCode
    );

    els.switchRoomBtn?.addEventListener(
        "click",
        switchRoom
    );

    els.myLocationBtn?.addEventListener(
        "click",
        centerOnMyLocation
    );

    els.centerMapBtn?.addEventListener(
        "click",
        fitAllUsers
    );

    els.themeBtn?.addEventListener(
        "click",
        toggleTheme
    );


    els.userName?.addEventListener(
        "input",
        () => {
            saveUserName(
                getName()
            );
        }
    );


    els.roomCode?.addEventListener(
        "input",
        () => {
            els.roomCode.value =
                normalizeRoomCode(
                    els.roomCode.value
                );
        }
    );


    els.switchRoomInput?.addEventListener(
        "input",
        () => {
            els.switchRoomInput.value =
                normalizeRoomCode(
                    els.switchRoomInput.value
                );
        }
    );


    els.roomCode?.addEventListener(
        "keydown",
        event => {
            if (event.key === "Enter") {
                event.preventDefault();
                joinRoom();
            }
        }
    );


    els.switchRoomInput?.addEventListener(
        "keydown",
        event => {
            if (event.key === "Enter") {
                event.preventDefault();
                switchRoom();
            }
        }
    );
}


/* =========================================================
   WEBSOCKET
   ========================================================= */

function getWebSocketURL() {

    const protocol =
        location.protocol === "https:"
            ? "wss:"
            : "ws:";

    return (
        protocol +
        "//" +
        location.host
    );
}


function connectWebSocket() {

    if (
        state.connecting ||
        (
            state.ws &&
            (
                state.ws.readyState ===
                WebSocket.OPEN ||
                state.ws.readyState ===
                WebSocket.CONNECTING
            )
        )
    ) {
        return;
    }


    state.connecting = true;

    updateConnection(
        "Ulanmoqda...",
        false
    );


    let ws;

    try {
        ws = new WebSocket(
            getWebSocketURL()
        );
    } catch (error) {
        state.connecting = false;

        updateConnection(
            "Offline",
            false
        );

        scheduleReconnect();

        return;
    }


    state.ws = ws;


    ws.addEventListener(
        "open",
        () => {

            state.connecting = false;
            state.connected = true;

            state.reconnectDelay = 1000;

            updateConnection(
                "Online",
                true
            );


            /*
             * F5 bosilganda:
             * saqlangan guruh avtomatik qayta ulanadi.
             */

            if (state.roomCode) {

                state.pendingAction = "join";
                state.pendingRoomCode =
                    state.roomCode;

                sendJoin(
                    state.roomCode
                );

            }
        }
    );


    ws.addEventListener(
        "message",
        event => {

            let data;

            try {
                data =
                    JSON.parse(
                        event.data
                    );
            } catch {
                return;
            }

            handleMessage(data);
        }
    );


    ws.addEventListener(
        "close",
        () => {

            state.connected = false;
            state.connecting = false;

            updateConnection(
                "Offline",
                false
            );

            if (
                state.roomCode &&
                !state.joining
            ) {
                updateRoomConnection(
                    "Qayta ulanmoqda..."
                );
            }

            scheduleReconnect();
        }
    );


    ws.addEventListener(
        "error",
        () => {

            state.connected = false;

            updateConnection(
                "Offline",
                false
            );
        }
    );
}


function scheduleReconnect() {

    if (state.reconnectTimer) {
        return;
    }

    state.reconnectTimer =
        setTimeout(
            () => {

                state.reconnectTimer = null;

                connectWebSocket();

            },
            state.reconnectDelay
        );


    state.reconnectDelay =
        Math.min(
            state.reconnectDelay * 2,
            10000
        );
}


function send(data) {

    if (
        !state.ws ||
        state.ws.readyState !==
        WebSocket.OPEN
    ) {
        return false;
    }

    try {

        state.ws.send(
            JSON.stringify(data)
        );

        return true;

    } catch {
        return false;
    }
}


/* =========================================================
   WEBSOCKET MESSAGES
   ========================================================= */

function handleMessage(data) {

    if (!data || !data.type) {
        return;
    }


    if (data.type === "connected") {

        if (data.userId) {
            saveUserId(
                data.userId
            );
        }

        return;
    }


    if (data.type === "room-created") {

        const code =
            normalizeRoomCode(
                data.roomCode
            );

        if (data.userId) {
            saveUserId(
                data.userId
            );
        }

        state.joining = false;
        state.pendingAction = null;
        state.pendingRoomCode = null;

        saveRoomCode(code);

        addSavedGroup(
            code,
            getName()
        );

        showRoom(code);

        startLocation();

        clearErrors();

        return;
    }


    if (data.type === "joined-room") {

        const code =
            normalizeRoomCode(
                data.roomCode ||
                state.pendingRoomCode ||
                state.roomCode
            );


        if (data.userId) {
            saveUserId(
                data.userId
            );
        }


        state.joining = false;
        state.pendingAction = null;
        state.pendingRoomCode = null;


        saveRoomCode(code);

        addSavedGroup(
            code,
            getName()
        );

        showRoom(code);

        startLocation();

        clearErrors();

        return;
    }


    if (data.type === "users") {

        state.users =
            Array.isArray(data.users)
                ? data.users
                : [];

        renderUsers(
            state.users
        );

        return;
    }


    if (data.type === "left-room") {

        state.joining = false;

        showSetup();

        return;
    }


    if (data.type === "error") {

        state.joining = false;

        showError(
            data.message ||
            "Xatolik yuz berdi."
        );

        setButtonLoading(
            false
        );

        return;
    }
}


/* =========================================================
   CREATE ROOM
   ========================================================= */

function createRoom() {

    clearErrors();

    const name =
        getName();


    if (!name) {

        showError(
            "Iltimos, ismingizni kiriting."
        );

        els.userName?.focus();

        return;
    }


    saveUserName(name);


    if (!state.connected) {

        state.pendingAction =
            "create";

        setButtonLoading(
            true,
            els.createRoomBtn
        );

        showError(
            "Serverga ulanmoqda. Biroz kuting..."
        );

        connectWebSocket();

        return;
    }


    setButtonLoading(
        true,
        els.createRoomBtn
    );


    const success =
        send({
            type: "create-room",
            name,
            userId:
                state.userId || null
        });


    if (!success) {

        setButtonLoading(
            false
        );

        showError(
            "Server bilan aloqa yo‘q."
        );

        return;
    }
}


/* =========================================================
   JOIN ROOM
   ========================================================= */

function joinRoom() {

    clearErrors();

    const name =
        getName();

    const code =
        normalizeRoomCode(
            els.roomCode?.value
        );


    if (!name) {

        showError(
            "Iltimos, ismingizni kiriting."
        );

        els.userName?.focus();

        return;
    }


    if (!/^[A-Z0-9]{6}$/.test(code)) {

        showError(
            "Guruh kodi 6 ta belgidan iborat bo‘lishi kerak."
        );

        els.roomCode?.focus();

        return;
    }


    saveUserName(name);
    saveRoomCode(code);


    if (!state.connected) {

        state.pendingAction =
            "join";

        state.pendingRoomCode =
            code;

        setButtonLoading(
            true,
            els.joinRoomBtn
        );

        showError(
            "Serverga ulanmoqda. Biroz kuting..."
        );

        connectWebSocket();

        return;
    }


    sendJoin(code);
}


function sendJoin(code) {

    code =
        normalizeRoomCode(code);


    if (!/^[A-Z0-9]{6}$/.test(code)) {
        return;
    }


    const name =
        getName();


    if (!name) {
        showError(
            "Iltimos, ismingizni kiriting."
        );
        return;
    }


    state.joining = true;

    state.pendingAction =
        "join";

    state.pendingRoomCode =
        code;


    setButtonLoading(
        true,
        els.joinRoomBtn
    );


    const success =
        send({
            type: "join-room",
            roomCode: code,
            name,
            userId:
                state.userId || null
        });


    if (!success) {

        state.joining = false;

        setButtonLoading(
            false
        );

        showError(
            "Server bilan aloqa yo‘q."
        );
    }
}


/* =========================================================
   SWITCH ROOM
   ========================================================= */

function switchRoom() {

    clearErrors();

    const code =
        normalizeRoomCode(
            els.switchRoomInput?.value
        );


    if (!/^[A-Z0-9]{6}$/.test(code)) {

        showError(
            "Guruh kodi noto‘g‘ri."
        );

        return;
    }


    const name =
        getName();


    if (!name) {

        showError(
            "Ismingizni kiriting."
        );

        return;
    }


    saveUserName(name);
    saveRoomCode(code);


    state.pendingRoomCode =
        code;

    state.joining = true;


    if (
        state.connected
    ) {

        send({
            type: "join-room",
            roomCode: code,
            name,
            userId:
                state.userId || null
        });

    } else {

        connectWebSocket();

        showError(
            "Serverga ulanmoqda..."
        );
    }
}


/* =========================================================
   ROOM UI
   ========================================================= */

function showRoom(code) {

    code =
        normalizeRoomCode(code);


    if (els.currentRoomCode) {
        els.currentRoomCode.textContent =
            code;
    }


    if (els.setupCard) {
        els.setupCard.classList.add(
            "hidden"
        );

        els.setupCard.style.display =
            "none";
    }


    if (els.roomCard) {

        els.roomCard.classList.remove(
            "hidden"
        );

        els.roomCard.style.display =
            "block";
    }


    updateRoomConnection(
        state.connected
            ? "Ulangan"
            : "Ulanmoqda..."
    );


    clearErrors();


    setTimeout(
        () => {

            if (
                state.map
            ) {

                state.map.invalidateSize();

                fitAllUsers();
            }

        },
        150
    );
}


function showSetup() {

    if (els.roomCard) {

        els.roomCard.classList.add(
            "hidden"
        );

        els.roomCard.style.display =
            "none";
    }


    if (els.setupCard) {

        els.setupCard.classList.remove(
            "hidden"
        );

        els.setupCard.style.display =
            "block";
    }


    setButtonLoading(false);
}


/* =========================================================
   ERROR
   ========================================================= */

function showError(message) {

    const text =
        String(message || "")
            .trim();


    const target =
        els.roomCard &&
        !els.roomCard.classList.contains(
            "hidden"
        )
            ? els.roomError
            : els.setupError;


    if (!target) {
        return;
    }


    if (els.setupError) {
        els.setupError.textContent = "";
    }

    if (els.roomError) {
        els.roomError.textContent = "";
    }


    target.textContent =
        text;

    target.classList.add(
        "show"
    );
}


function clearErrors() {

    [
        els.setupError,
        els.roomError
    ].forEach(
        element => {

            if (!element) return;

            element.textContent = "";

            element.classList.remove(
                "show"
            );
        }
    );
}


/* =========================================================
   BUTTON LOADING
   ========================================================= */

function setButtonLoading(
    loading,
    specificButton = null
) {

    const buttons =
        specificButton
            ? [specificButton]
            : [
                els.createRoomBtn,
                els.joinRoomBtn,
                els.switchRoomBtn
            ];


    buttons.forEach(
        button => {

            if (!button) return;


            if (loading) {

                if (
                    !button.dataset.originalText
                ) {
                    button.dataset.originalText =
                        button.innerText;
                }


                button.disabled =
                    true;

                button.classList.add(
                    "loading"
                );


                if (
                    button ===
                    els.createRoomBtn
                ) {

                    button.innerHTML =
                        "⏳ Yaratilmoqda...";

                } else if (
                    button ===
                    els.joinRoomBtn
                ) {

                    button.innerHTML =
                        "⏳ Ulanmoqda...";

                } else {

                    button.innerHTML =
                        "⏳ Kuting...";
                }

            } else {

                button.disabled =
                    false;

                button.classList.remove(
                    "loading"
                );


                if (
                    button.dataset.originalText
                ) {

                    button.innerHTML =
                        button.dataset.originalText;

                    delete button.dataset.originalText;
                }
            }
        }
    );
}


/* =========================================================
   CONNECTION STATUS
   ========================================================= */

function updateConnection(
    text,
    online
) {

    if (els.connectionText) {
        els.connectionText.textContent =
            text;
    }


    if (els.connectionPill) {

        els.connectionPill.classList.toggle(
            "online",
            !!online
        );

        els.connectionPill.classList.toggle(
            "offline",
            !online
        );
    }


    updateRoomConnection(
        text
    );
}


function updateRoomConnection(text) {

    if (els.connectionStatus) {

        els.connectionStatus.textContent =
            text;
    }
}


/* =========================================================
   MAP
   ========================================================= */

function initMap() {

    if (
        !els.map ||
        typeof L === "undefined"
    ) {
        return;
    }


    state.map =
        L.map(
            els.map,
            {
                zoomControl: true,
                attributionControl: true
            }
        )
        .setView(
            [41.3111, 69.2797],
            12
        );


    L.tileLayer(
        "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png",
        {
            maxZoom: 19,
            attribution:
                '&copy; OpenStreetMap contributors'
        }
    ).addTo(
        state.map
    );
}


/* =========================================================
   GPS
   ========================================================= */

function startLocation() {

    if (
        !navigator.geolocation
    ) {

        updateLocationStatus(
            "GPS mavjud emas"
        );

        return;
    }


    if (
        state.locationWatchId !== null
    ) {
        return;
    }


    updateLocationStatus(
        "Kutilmoqda..."
    );


    state.locationWatchId =
        navigator.geolocation.watchPosition(
            position => {

                state.currentPosition =
                    position;

                const lat =
                    position.coords.latitude;

                const lng =
                    position.coords.longitude;

                const accuracy =
                    position.coords.accuracy;


                updateLocationStatus(
                    "Aniqlandi"
                );


                updateMyMarker(
                    lat,
                    lng,
                    accuracy
                );


                send({
                    type: "location",
                    lat,
                    lng,
                    accuracy
                });


                fitMapIfNeeded();
            },

            error => {

                let message =
                    "GPS xatosi";

                if (
                    error.code ===
                    error.PERMISSION_DENIED
                ) {
                    message =
                        "GPS ruxsati berilmadi";
                }

                if (
                    error.code ===
                    error.POSITION_UNAVAILABLE
                ) {
                    message =
                        "Joylashuv topilmadi";
                }

                if (
                    error.code ===
                    error.TIMEOUT
                ) {
                    message =
                        "GPS kutish vaqti tugadi";
                }


                updateLocationStatus(
                    message
                );
            },

            {
                enableHighAccuracy: true,
                maximumAge: 5000,
                timeout: 15000
            }
        );
}


function updateLocationStatus(text) {

    if (
        els.locationStatus
    ) {
        els.locationStatus.textContent =
            text;
    }
}


/* =========================================================
   MARKERS
   ========================================================= */

function createMarkerIcon(
    online,
    isMe
) {

    const color =
        online
            ? "#19d66b"
            : "#8a9490";


    const size =
        isMe
            ? 18
            : 15;


    return L.divIcon({
        className:
            "live-gps-marker-wrapper",

        html: `
            <div
                style="
                    width:${size}px;
                    height:${size}px;
                    border-radius:50%;
                    background:${color};
                    border:3px solid white;
                    box-shadow:0 4px 14px rgba(0,0,0,.25);
                "
            ></div>
        `,

        iconSize: [
            size,
            size
        ],

        iconAnchor: [
            size / 2,
            size / 2
        ]
    });
}


function updateMyMarker(
    lat,
    lng,
    accuracy
) {

    if (
        !state.map
    ) {
        return;
    }


    const id =
        state.userId ||
        "__me";


    let marker =
        state.markers.get(id);


    if (!marker) {

        marker =
            L.marker(
                [lat, lng],
                {
                    icon:
                        createMarkerIcon(
                            true,
                            true
                        ),
                    zIndexOffset: 1000
                }
            )
            .addTo(
                state.map
            );


        state.markers.set(
            id,
            marker
        );
    }


    marker.setLatLng(
        [lat, lng]
    );


    marker.bindPopup(
        "<strong>Siz</strong><br>Joylashuvingiz"
    );


    if (
        Number.isFinite(
            accuracy
        )
    ) {

        let circle =
            state.accuracyCircles.get(
                id
            );


        if (!circle) {

            circle =
                L.circle(
                    [lat, lng],
                    {
                        radius: accuracy,
                        weight: 1,
                        fillOpacity: 0.08
                    }
                )
                .addTo(
                    state.map
                );


            state.accuracyCircles.set(
                id,
                circle
            );

        } else {

            circle.setLatLng(
                [lat, lng]
            );

            circle.setRadius(
                accuracy
            );
        }
    }
}


/* =========================================================
   USERS
   ========================================================= */

function renderUsers(users) {

    if (!Array.isArray(users)) {
        users = [];
    }


    if (els.membersCount) {

        const onlineCount =
            users.filter(
                user =>
                    user.online
            ).length;


        els.membersCount.textContent =
            String(
                onlineCount
            );
    }


    if (
        els.membersList
    ) {

        if (!users.length) {

            els.membersList.innerHTML = `
                <div class="empty-members">
                    A'zolar kutilmoqda...
                </div>
            `;

        } else {

            els.membersList.innerHTML =
                users
                    .map(
                        renderMember
                    )
                    .join("");
        }
    }


    updateMapMarkers(
        users
    );
}


function renderMember(user) {

    const isMe =
        user.id ===
        state.userId;


    const online =
        !!user.online;


    const name =
        escapeHTML(
            user.name ||
            "Noma'lum"
        );


    const status =
        online
            ? "Online"
            : "Offline";


    const statusClass =
        online
            ? "online"
            : "offline";


    return `
        <div
            class="member-item"
            data-user-id="${escapeHTML(
                String(user.id || "")
            )}"
        >

            <div class="member-avatar">
                ${escapeHTML(
                    (user.name || "N")
                        .charAt(0)
                        .toUpperCase()
                )}
            </div>

            <div class="member-info">

                <strong>
                    ${name}
                    ${
                        isMe
                            ? " <span>(Siz)</span>"
                            : ""
                    }
                </strong>

                <small>
                    ${
                        Number.isFinite(
                            Number(user.lat)
                        ) &&
                        Number.isFinite(
                            Number(user.lng)
                        )
                            ? `${Number(user.lat).toFixed(5)}, ${Number(user.lng).toFixed(5)}`
                            : "Joylashuv mavjud emas"
                    }
                </small>

            </div>

            <div class="member-status ${statusClass}">
                <span></span>
                ${status}
            </div>

        </div>
    `;
}


function updateMapMarkers(users) {

    if (
        !state.map
    ) {
        return;
    }


    const activeIds =
        new Set();


    users.forEach(
        user => {

            const lat =
                Number(user.lat);

            const lng =
                Number(user.lng);


            if (
                !Number.isFinite(lat) ||
                !Number.isFinite(lng)
            ) {
                return;
            }


            const id =
                String(user.id);


            activeIds.add(id);


            const isMe =
                id ===
                String(state.userId);


            let marker =
                state.markers.get(id);


            if (!marker) {

                marker =
                    L.marker(
                        [lat, lng],
                        {
                            icon:
                                createMarkerIcon(
                                    !!user.online,
                                    isMe
                                ),
                            opacity:
                                user.online
                                    ? 1
                                    : 0.55,
                            zIndexOffset:
                                isMe
                                    ? 1000
                                    : 0
                        }
                    )
                    .addTo(
                        state.map
                    );


                state.markers.set(
                    id,
                    marker
                );

            } else {

                marker.setLatLng(
                    [lat, lng]
                );


                marker.setOpacity(
                    user.online
                        ? 1
                        : 0.55
                );


                marker.setIcon(
                    createMarkerIcon(
                        !!user.online,
                        isMe
                    )
                );
            }


            const title =
                isMe
                    ? "Siz"
                    : escapeHTML(
                        user.name ||
                        "Noma'lum"
                    );


            const status =
                user.online
                    ? "Online"
                    : "Offline";


            marker.bindPopup(
                `
                <strong>${title}</strong>
                <br>
                ${status}
                <br>
                ${lat.toFixed(5)},
                ${lng.toFixed(5)}
                `
            );
        }
    );


    /*
     * Eski markerlarni olib tashlaymiz.
     * Lekin offline foydalanuvchi hali users ichida bo'lsa,
     * uning oxirgi joylashuvi saqlanadi.
     */

    for (
        const [id, marker]
        of state.markers
    ) {

        if (
            id ===
            String(state.userId)
        ) {
            continue;
        }


        if (
            !activeIds.has(id)
        ) {

            try {
                state.map.removeLayer(
                    marker
                );
            } catch {}


            state.markers.delete(
                id
            );
        }
    }
}


/* =========================================================
   MAP CONTROLS
   ========================================================= */

function centerOnMyLocation() {

    if (
        !state.map
    ) {
        return;
    }


    if (
        state.currentPosition
    ) {

        const lat =
            state.currentPosition.coords.latitude;

        const lng =
            state.currentPosition.coords.longitude;


        state.map.setView(
            [lat, lng],
            17,
            {
                animate: true
            }
        );

        return;
    }


    const me =
        state.users.find(
            user =>
                user.id ===
                state.userId
        );


    if (
        me &&
        Number.isFinite(
            Number(me.lat)
        ) &&
        Number.isFinite(
            Number(me.lng)
        )
    ) {

        state.map.setView(
            [
                Number(me.lat),
                Number(me.lng)
            ],
            17,
            {
                animate: true
            }
        );
    }
}


function fitAllUsers() {

    if (
        !state.map
    ) {
        return;
    }


    const points = [];


    state.users.forEach(
        user => {

            const lat =
                Number(user.lat);

            const lng =
                Number(user.lng);


            if (
                Number.isFinite(lat) &&
                Number.isFinite(lng)
            ) {

                points.push(
                    [lat, lng]
                );
            }
        }
    );


    if (
        state.currentPosition
    ) {

        points.push([
            state.currentPosition.coords.latitude,
            state.currentPosition.coords.longitude
        ]);
    }


    if (!points.length) {

        state.map.setView(
            [41.3111, 69.2797],
            12
        );

        return;
    }


    if (
        points.length === 1
    ) {

        state.map.setView(
            points[0],
            16,
            {
                animate: true
            }
        );

        return;
    }


    const bounds =
        L.latLngBounds(
            points
        );


    state.map.fitBounds(
        bounds,
        {
            padding: [
                50,
                50
            ],
            maxZoom: 16,
            animate: true
        }
    );
}


function fitMapIfNeeded() {

    if (
        !state.map
    ) {
        return;
    }


    if (
        state.map.getZoom() < 5
    ) {
        centerOnMyLocation();
    }
}


/* =========================================================
   COPY
   ========================================================= */

async function copyRoomCode() {

    const code =
        state.roomCode ||
        els.currentRoomCode?.textContent ||
        "";


    if (!code) {
        return;
    }


    try {

        await navigator.clipboard.writeText(
            code
        );

        showCopySuccess();

    } catch {

        fallbackCopy(
            code
        );

        showCopySuccess();
    }
}


function fallbackCopy(text) {

    const input =
        document.createElement(
            "textarea"
        );


    input.value =
        text;


    input.style.position =
        "fixed";

    input.style.opacity =
        "0";


    document.body.appendChild(
        input
    );


    input.select();


    try {
        document.execCommand(
            "copy"
        );
    } catch {}


    input.remove();
}


function showCopySuccess() {

    if (!els.copyRoomText) {
        return;
    }


    const oldText =
        els.copyRoomText.textContent;


    els.copyRoomText.textContent =
        "Nusxalandi ✓";


    setTimeout(
        () => {

            if (
                els.copyRoomText
            ) {
                els.copyRoomText.textContent =
                    oldText;
            }

        },
        1600
    );
}


/* =========================================================
   SAVED GROUPS
   ========================================================= */

function getSavedGroups() {

    try {

        const value =
            localStorage.getItem(
                STORAGE.SAVED_GROUPS
            );


        if (!value) {
            return [];
        }


        const groups =
            JSON.parse(
                value
            );


        if (
            !Array.isArray(groups)
        ) {
            return [];
        }


        return groups
            .filter(
                group =>
                    group &&
                    /^[A-Z0-9]{6}$/.test(
                        group.code
                    )
            )
            .slice(0, 10);

    } catch {

        return [];
    }
}


function saveSavedGroups(groups) {

    localStorage.setItem(
        STORAGE.SAVED_GROUPS,
        JSON.stringify(
            groups.slice(0, 10)
        )
    );
}


function addSavedGroup(
    code,
    name
) {

    code =
        normalizeRoomCode(code);


    if (
        !/^[A-Z0-9]{6}$/.test(code)
    ) {
        return;
    }


    let groups =
        getSavedGroups();


    groups =
        groups.filter(
            group =>
                group.code !== code
        );


    groups.unshift({
        code,
        name:
            String(
                name || ""
            )
                .trim()
                .slice(0, 30),

        savedAt:
            Date.now()
    });


    saveSavedGroups(
        groups
    );


    renderSavedGroups();
}


function removeSavedGroup(
    code
) {

    let groups =
        getSavedGroups();


    groups =
        groups.filter(
            group =>
                group.code !== code
        );


    saveSavedGroups(
        groups
    );


    renderSavedGroups();
}


function renderSavedGroups() {

    const existing =
        document.getElementById(
            "savedGroupsSection"
        );


    if (existing) {
        existing.remove();
    }


    const groups =
        getSavedGroups();


    if (
        !groups.length ||
        !els.setupCard
    ) {
        return;
    }


    const section =
        document.createElement(
            "div"
        );


    section.id =
        "savedGroupsSection";


    section.className =
        "saved-groups-section";


    section.innerHTML = `
        <div class="saved-groups-head">
            <div>
                <strong>Saqlangan guruhlar</strong>
                <span>Oldingi guruhlaringiz</span>
            </div>

            <span class="saved-groups-count">
                ${groups.length}
            </span>
        </div>

        <div class="saved-groups-list">
            ${groups.map(group => `
                <div
                    class="saved-group-item"
                    data-code="${escapeHTML(group.code)}"
                >

                    <button
                        type="button"
                        class="saved-group-open"
                        data-open-code="${escapeHTML(group.code)}"
                    >

                        <span class="saved-group-icon">
                            ⌖
                        </span>

                        <span class="saved-group-main">

                            <strong>
                                ${escapeHTML(group.code)}
                            </strong>

                            <small>
                                ${escapeHTML(
                                    group.name ||
                                    "Saqlangan guruh"
                                )}
                            </small>

                        </span>

                        <span class="saved-group-arrow">
                            →
                        </span>

                    </button>

                    <button
                        type="button"
                        class="saved-group-delete"
                        title="O'chirish"
                        data-delete-code="${escapeHTML(group.code)}"
                    >
                        ×
                    </button>

                </div>
            `).join("")}
        </div>
    `;


    const content =
        els.setupCard.querySelector(
            ".setup-content"
        );


    if (content) {
        content.after(
            section
        );
    } else {
        els.setupCard.appendChild(
            section
        );
    }


    section
        .querySelectorAll(
            "[data-open-code]"
        )
        .forEach(
            button => {

                button.addEventListener(
                    "click",
                    () => {

                        const code =
                            button.dataset.openCode;

                        if (
                            els.roomCode
                        ) {
                            els.roomCode.value =
                                code;
                        }

                        joinRoom();
                    }
                );
            }
        );


    section
        .querySelectorAll(
            "[data-delete-code]"
        )
        .forEach(
            button => {

                button.addEventListener(
                    "click",
                    event => {

                        event.stopPropagation();

                        removeSavedGroup(
                            button.dataset.deleteCode
                        );
                    }
                );
            }
        );
}


/* =========================================================
   THEME
   ========================================================= */

function initTheme() {

    const saved =
        localStorage.getItem(
            STORAGE.THEME
        );


    if (
        saved === "dark" ||
        saved === "light"
    ) {

        document.documentElement.dataset.theme =
            saved;

    } else {

        const prefersDark =
            window.matchMedia &&
            window.matchMedia(
                "(prefers-color-scheme: dark)"
            ).matches;


        document.documentElement.dataset.theme =
            prefersDark
                ? "dark"
                : "light";
    }


    updateThemeButton();
}


function toggleTheme() {

    const current =
        document.documentElement.dataset.theme ||
        "light";


    const next =
        current === "dark"
            ? "light"
            : "dark";


    document.documentElement.dataset.theme =
        next;


    localStorage.setItem(
        STORAGE.THEME,
        next
    );


    updateThemeButton();
}


function updateThemeButton() {

    if (!els.themeIcon) {
        return;
    }


    const theme =
        document.documentElement.dataset.theme;


    els.themeIcon.textContent =
        theme === "dark"
            ? "☀"
            : "☾";
}


/* =========================================================
   HELPERS
   ========================================================= */

function escapeHTML(value) {

    return String(value ?? "")
        .replace(
            /&/g,
            "&amp;"
        )
        .replace(
            /</g,
            "&lt;"
        )
        .replace(
            />/g,
            "&gt;"
        )
        .replace(
            /"/g,
            "&quot;"
        )
        .replace(
            /'/g,
            "&#039;"
        );
}


/* =========================================================
   PAGE VISIBILITY
   ========================================================= */

document.addEventListener(
    "visibilitychange",
    () => {

        if (
            document.visibilityState ===
            "visible"
        ) {

            if (
                !state.ws ||
                state.ws.readyState !==
                WebSocket.OPEN
            ) {

                connectWebSocket();
            }


            if (
                state.map
            ) {

                setTimeout(
                    () => {
                        state.map.invalidateSize();
                    },
                    100
                );
            }
        }
    }
);


/* =========================================================
   BEFORE UNLOAD
   ========================================================= */

/*
 * Bu yerda localStorage o'chirilmaydi.
 *
 * F5 bosilganda:
 *
 * 1. Browser WebSocketni yopadi.
 * 2. Room code localStorage'da qoladi.
 * 3. Sahifa qayta ochiladi.
 * 4. WebSocket qayta ulanadi.
 * 5. Saqlangan room code bilan join-room yuboriladi.
 *
 * Shuning uchun F5 guruhni o'chirmaydi.
 */


/* =========================================================
   MOBILE SAFETY
   ========================================================= */

window.addEventListener(
    "resize",
    () => {

        if (
            state.map
        ) {

            setTimeout(
                () => {
                    state.map.invalidateSize();
                },
                100
            );
        }
    }
);


/* =========================================================
   GLOBAL ERROR PROTECTION
   ========================================================= */

window.addEventListener(
    "error",
    event => {

        console.error(
            "Live GPS error:",
            event.error || event.message
        );
    }
);


window.addEventListener(
    "unhandledrejection",
    event => {

        console.error(
            "Live GPS promise error:",
            event.reason
        );
    }
);
