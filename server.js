"use strict";

/* =========================================================
   LIVE GPS — CLIENT
   server.js ga moslashtirilgan
   ========================================================= */


/* =========================================================
   CONFIG
   ========================================================= */

const SERVER_URL =
    window.location.hostname === "localhost" ||
    window.location.hostname === "127.0.0.1"
        ? `ws://${window.location.host}`
        : `wss://${window.location.host}`;


/* =========================================================
   STATE
   ========================================================= */

let ws = null;

let currentUserId =
    localStorage.getItem("gps-user-id") || null;

let currentUserName =
    localStorage.getItem("gps-user-name") || "";

let currentRoomCode =
    localStorage.getItem("gps-room-code") || "";

let pendingAction = null;

let reconnectTimer = null;
let reconnectAttempts = 0;
let manuallyClosed = false;

let watchId = null;

let myLatitude = null;
let myLongitude = null;
let myAccuracy = null;

let users = [];

let map = null;
let mapInitialized = false;

let myMarker = null;

const userMarkers = new Map();

let savedGroups = [];

const SAVED_GROUPS_KEY = "gps-saved-groups";


/* =========================================================
   HELPERS
   ========================================================= */

function $(id) {
    return document.getElementById(id);
}


function normalizeRoomCode(value) {
    return String(value || "")
        .trim()
        .toUpperCase()
        .replace(/[^A-Z0-9]/g, "")
        .slice(0, 6);
}


function normalizeName(value) {
    return String(value || "")
        .trim()
        .slice(0, 100);
}


function escapeHtml(value) {
    return String(value ?? "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
}


function isValidRoomCode(code) {
    return /^[A-Z0-9]{6}$/.test(code);
}


function setText(id, value) {
    const el = $(id);

    if (el) {
        el.textContent = value;
    }
}


/* =========================================================
   ERROR
   ========================================================= */

function showRoomError(message) {
    const el = $("roomError");

    if (!el) {
        console.error("ROOM ERROR:", message);
        return;
    }

    el.textContent = message || "";
    el.style.display = message ? "block" : "none";
}


function clearRoomError() {
    showRoomError("");
}


/* =========================================================
   CONNECTION STATUS
   ========================================================= */

function setConnectionStatus(text, connected = false) {
    setText("connectionStatus", text);

    const pill =
        $("connectionStatus") ||
        $("connectionPill");

    if (pill) {
        pill.classList.toggle("connected", connected);
        pill.classList.toggle("online", connected);
    }
}


function setLocationStatus(text, active = false) {
    setText("locationStatus", text);

    const el = $("locationStatus");

    if (el) {
        el.classList.toggle("active", active);
        el.classList.toggle("online", active);
    }
}


/* =========================================================
   LOCAL STORAGE
   ========================================================= */

function loadSavedGroups() {
    try {
        const raw =
            localStorage.getItem(
                SAVED_GROUPS_KEY
            );

        if (!raw) {
            savedGroups = [];
            return;
        }

        const parsed = JSON.parse(raw);

        if (Array.isArray(parsed)) {
            savedGroups = parsed
                .map(item => {
                    if (typeof item === "string") {
                        return {
                            code: normalizeRoomCode(item),
                            name: ""
                        };
                    }

                    return {
                        code: normalizeRoomCode(item?.code),
                        name: normalizeName(item?.name)
                    };
                })
                .filter(item =>
                    isValidRoomCode(item.code)
                );
        } else {
            savedGroups = [];
        }

    } catch (error) {
        console.error(
            "Saved groups load error:",
            error
        );

        savedGroups = [];
    }

    renderSavedGroups();
}


function saveSavedGroups() {
    try {
        localStorage.setItem(
            SAVED_GROUPS_KEY,
            JSON.stringify(savedGroups)
        );
    } catch (error) {
        console.error(
            "Saved groups save error:",
            error
        );
    }
}


function addSavedGroup(code, name = "") {
    code = normalizeRoomCode(code);

    if (!isValidRoomCode(code)) {
        return;
    }

    const existing =
        savedGroups.find(
            group => group.code === code
        );

    if (existing) {
        if (name) {
            existing.name = normalizeName(name);
        }
    } else {
        savedGroups.unshift({
            code,
            name: normalizeName(name)
        });
    }

    if (savedGroups.length > 20) {
        savedGroups =
            savedGroups.slice(0, 20);
    }

    saveSavedGroups();
    renderSavedGroups();
}


function removeSavedGroup(code) {
    code = normalizeRoomCode(code);

    savedGroups =
        savedGroups.filter(
            group => group.code !== code
        );

    saveSavedGroups();
    renderSavedGroups();
}


function renderSavedGroups() {
    const section =
        $("savedGroupsSection");

    const list =
        $("savedGroupsList");

    const count =
        $("savedGroupsCount");

    if (count) {
        count.textContent =
            String(savedGroups.length);
    }

    if (!list) {
        return;
    }

    if (!savedGroups.length) {
        list.innerHTML = `
            <div class="empty-saved-groups">
                Hozircha saqlangan guruh yo‘q.
            </div>
        `;

        if (section) {
            section.style.display = "";
        }

        return;
    }

    list.innerHTML =
        savedGroups.map(group => `
            <div class="saved-group-item">
                <button
                    type="button"
                    class="saved-group-main"
                    data-join-saved="${escapeHtml(group.code)}"
                >
                    <span class="saved-group-icon">📍</span>

                    <span class="saved-group-info">
                        <strong>${escapeHtml(group.code)}</strong>
                        ${
                            group.name
                                ? `<small>${escapeHtml(group.name)}</small>`
                                : ""
                        }
                    </span>

                    <span class="saved-group-arrow">→</span>
                </button>

                <button
                    type="button"
                    class="saved-group-delete"
                    data-delete-saved="${escapeHtml(group.code)}"
                    aria-label="O‘chirish"
                >
                    ×
                </button>
            </div>
        `).join("");

    list
        .querySelectorAll("[data-join-saved]")
        .forEach(button => {
            button.addEventListener(
                "click",
                () => {
                    const code =
                        button.getAttribute(
                            "data-join-saved"
                        );

                    joinSavedGroup(code);
                }
            );
        });

    list
        .querySelectorAll("[data-delete-saved]")
        .forEach(button => {
            button.addEventListener(
                "click",
                () => {
                    const code =
                        button.getAttribute(
                            "data-delete-saved"
                        );

                    removeSavedGroup(code);
                }
            );
        });
}


function joinSavedGroup(code) {
    code = normalizeRoomCode(code);

    if (!isValidRoomCode(code)) {
        showRoomError(
            "Saqlangan guruh kodi noto‘g‘ri."
        );
        return;
    }

    const name =
        normalizeName(
            $("userName")?.value ||
            currentUserName
        );

    if (!name) {
        showRoomError(
            "Avval ismingizni kiriting."
        );

        $("userName")?.focus();

        return;
    }

    if ($("roomCode")) {
        $("roomCode").value = code;
    }

    currentUserName = name;

    localStorage.setItem(
        "gps-user-name",
        name
    );

    joinRoom();
}


/* =========================================================
   WEBSOCKET SEND
   ========================================================= */

function sendMessage(payload) {
    if (
        !ws ||
        ws.readyState !== WebSocket.OPEN
    ) {
        console.warn(
            "WebSocket ulanmagan:",
            payload
        );

        return false;
    }

    try {
        console.log(
            "CLIENT -> SERVER:",
            payload
        );

        ws.send(
            JSON.stringify(payload)
        );

        return true;

    } catch (error) {
        console.error(
            "WebSocket send error:",
            error
        );

        return false;
    }
}


/* =========================================================
   CONNECT WEBSOCKET
   ========================================================= */

function connectWebSocket() {
    manuallyClosed = false;

    if (
        ws &&
        (
            ws.readyState ===
            WebSocket.OPEN ||
            ws.readyState ===
            WebSocket.CONNECTING
        )
    ) {
        return;
    }

    clearTimeout(reconnectTimer);

    setConnectionStatus(
        "Ulanmoqda...",
        false
    );

    try {
        ws = new WebSocket(
            SERVER_URL
        );
    } catch (error) {
        console.error(
            "WebSocket create error:",
            error
        );

        scheduleReconnect();

        return;
    }


    ws.onopen = () => {
        console.log(
            "SERVER: connected"
        );

        reconnectAttempts = 0;

        setConnectionStatus(
            "Ulangan",
            true
        );


        /*
         * Serverga action yuboramiz.
         *
         * MUHIM:
         * server.js aynan roomCode kutadi.
         */

        if (pendingAction) {
            const action =
                {
                    ...pendingAction
                };

            console.log(
                "CLIENT ACTION:",
                action
            );

            sendMessage(action);

            pendingAction = null;
        }
    };


    ws.onmessage = event => {
        handleServerMessage(
            event.data
        );
    };


    ws.onerror = error => {
        console.error(
            "WebSocket error:",
            error
        );

        setConnectionStatus(
            "Ulanishda xato",
            false
        );
    };


    ws.onclose = () => {
        console.log(
            "SERVER: disconnected"
        );

        setConnectionStatus(
            "Ulanish uzildi",
            false
        );

        ws = null;

        if (!manuallyClosed) {
            scheduleReconnect();
        }
    };
}


/* =========================================================
   RECONNECT
   ========================================================= */

function scheduleReconnect() {
    if (manuallyClosed) {
        return;
    }

    clearTimeout(reconnectTimer);

    reconnectAttempts++;

    const delay =
        Math.min(
            1000 *
            Math.max(
                1,
                reconnectAttempts
            ),
            10000
        );

    reconnectTimer =
        setTimeout(
            () => {
                connectWebSocket();
            },
            delay
        );
}


/* =========================================================
   SERVER MESSAGE
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

    if (!data) {
        return;
    }

    console.log(
        "SERVER:",
        data
    );


    /* =====================================================
       CONNECTED
       ===================================================== */

    if (
        data.type ===
        "connected"
    ) {
        if (data.userId) {
            currentUserId =
                String(
                    data.userId
                );

            localStorage.setItem(
                "gps-user-id",
                currentUserId
            );

            console.log(
                "SERVER USER ID:",
                currentUserId
            );
        }

        /*
         * Agar pendingAction hali yuborilmagan
         * bo‘lsa, yuboramiz.
         */

        return;
    }


    /* =====================================================
       ROOM CREATED
       ===================================================== */

    if (
        data.type ===
        "room-created"
    ) {
        const code =
            normalizeRoomCode(
                data.roomCode
            );

        if (data.userId) {
            currentUserId =
                String(
                    data.userId
                );

            localStorage.setItem(
                "gps-user-id",
                currentUserId
            );
        }

        if (isValidRoomCode(code)) {
            currentRoomCode = code;

            localStorage.setItem(
                "gps-room-code",
                code
            );

            addSavedGroup(
                code,
                currentUserName
            );
        }

        showRoom();

        clearRoomError();

        setConnectionStatus(
            "Ulangan",
            true
        );

        startLocationTracking();

        return;
    }


    /* =====================================================
       JOINED ROOM
       ===================================================== */

    if (
        data.type ===
        "joined-room"
    ) {
        const code =
            normalizeRoomCode(
                data.roomCode
            );

        if (data.userId) {
            currentUserId =
                String(
                    data.userId
                );

            localStorage.setItem(
                "gps-user-id",
                currentUserId
            );
        }

        if (isValidRoomCode(code)) {
            currentRoomCode = code;

            localStorage.setItem(
                "gps-room-code",
                code
            );

            addSavedGroup(
                code,
                currentUserName
            );
        }

        clearRoomError();

        showRoom();

        setConnectionStatus(
            "Ulangan",
            true
        );

        startLocationTracking();

        return;
    }


    /* =====================================================
       USERS
       ===================================================== */

    if (
        data.type ===
        "users"
    ) {
        users =
            Array.isArray(data.users)
                ? data.users
                : [];

        renderUsers();
        updateMarkers();

        return;
    }


    /* =====================================================
       ERROR
       ===================================================== */

    if (
        data.type ===
        "error"
    ) {
        console.error(
            "SERVER ERROR:",
            data.message
        );

        showRoomError(
            data.message ||
            "Server xatosi."
        );

        setConnectionStatus(
            "Xatolik",
            false
        );

        return;
    }


    /* =====================================================
       LEFT ROOM
       ===================================================== */

    if (
        data.type ===
        "left-room"
    ) {
        stopLocationTracking();

        currentRoomCode = "";

        localStorage.removeItem(
            "gps-room-code"
        );

        users = [];

        clearMarkers();

        renderUsers();

        showSetup();

        setLocationStatus(
            "Joylashuv o‘chiq",
            false
        );

        return;
    }
}


/* =========================================================
   CREATE ROOM
   ========================================================= */

function createRoom() {
    clearRoomError();

    const name =
        normalizeName(
            $("userName")?.value
        );

    if (!name) {
        showRoomError(
            "Avval ismingizni kiriting."
        );

        $("userName")?.focus();

        return;
    }

    currentUserName = name;

    localStorage.setItem(
        "gps-user-name",
        name
    );


    /*
     * Server create-room paytida
     * userIdni qabul qiladi.
     */

    pendingAction = {
        type: "create-room",
        userId:
            currentUserId || null,
        name: name
    };


    if (
        ws &&
        ws.readyState === WebSocket.OPEN
    ) {
        sendMessage(
            pendingAction
        );

        pendingAction = null;

    } else {
        connectWebSocket();
    }
}


/* =========================================================
   JOIN ROOM
   ========================================================= */

function joinRoom() {
    clearRoomError();

    const name =
        normalizeName(
            $("userName")?.value
        );

    let roomCode =
        normalizeRoomCode(
            $("roomCode")?.value
        );


    if (!name) {
        showRoomError(
            "Avval ismingizni kiriting."
        );

        $("userName")?.focus();

        return;
    }


    if (!isValidRoomCode(roomCode)) {
        showRoomError(
            "Guruh kodi 6 ta harf yoki raqamdan iborat bo‘lishi kerak."
        );

        $("roomCode")?.focus();

        return;
    }


    if ($("roomCode")) {
        $("roomCode").value =
            roomCode;
    }


    currentUserName = name;
    currentRoomCode = roomCode;


    localStorage.setItem(
        "gps-user-name",
        name
    );

    localStorage.setItem(
        "gps-room-code",
        roomCode
    );


    /*
     * SERVER.JS UCHUN ENG MUHIM FORMAT:
     *
     * {
     *   type: "join-room",
     *   roomCode: "ABC123",
     *   userId: "...",
     *   name: "..."
     * }
     */

    pendingAction = {
        type: "join-room",

        roomCode: roomCode,

        userId:
            currentUserId || null,

        name: name
    };


    console.log(
        "JOIN REQUEST:",
        pendingAction
    );


    if (
        ws &&
        ws.readyState === WebSocket.OPEN
    ) {
        sendMessage(
            pendingAction
        );

        pendingAction = null;

    } else {
        connectWebSocket();
    }
}


/* =========================================================
   SHOW / HIDE SCREENS
   ========================================================= */

function showRoom() {
    const setup =
        $("setupCard");

    const room =
        $("roomCard");

    if (setup) {
        setup.style.display =
            "none";
    }

    if (room) {
        room.style.display =
            "";
    }

    setText(
        "currentRoomCode",
        currentRoomCode
    );

    renderUsers();
}


function showSetup() {
    const setup =
        $("setupCard");

    const room =
        $("roomCard");

    if (setup) {
        setup.style.display =
            "";
    }

    if (room) {
        room.style.display =
            "none";
    }
}


/* =========================================================
   COPY ROOM CODE
   ========================================================= */

async function copyRoomCode() {
    const code =
        currentRoomCode ||
        $("currentRoomCode")?.textContent ||
        "";

    if (!code) {
        return;
    }

    try {
        await navigator.clipboard.writeText(
            code
        );

        const button =
            $("copyRoomBtn");

        if (button) {
            const old =
                button.textContent;

            button.textContent =
                "✓ Nusxalandi";

            setTimeout(
                () => {
                    button.textContent =
                        old;
                },
                1500
            );
        }

    } catch (error) {
        console.error(
            "Clipboard error:",
            error
        );

        /*
         * Fallback
         */

        try {
            const textarea =
                document.createElement(
                    "textarea"
                );

            textarea.value = code;

            document.body.appendChild(
                textarea
            );

            textarea.select();

            document.execCommand(
                "copy"
            );

            textarea.remove();

        } catch {}
    }
}


/* =========================================================
   SWITCH ROOM
   ========================================================= */

function switchRoom() {
    const input =
        $("switchRoomInput");

    const code =
        normalizeRoomCode(
            input?.value
        );

    if (!isValidRoomCode(code)) {
        showRoomError(
            "Guruh kodi 6 ta belgi bo‘lishi kerak."
        );

        return;
    }

    const name =
        normalizeName(
            $("userName")?.value ||
            currentUserName
        );

    if (!name) {
        showRoomError(
            "Ismingizni kiriting."
        );

        return;
    }

    /*
     * Avval eski roomdan chiqamiz.
     */

    if (
        ws &&
        ws.readyState === WebSocket.OPEN &&
        currentRoomCode
    ) {
        sendMessage({
            type: "leave-room"
        });
    }

    currentUserName = name;

    if ($("roomCode")) {
        $("roomCode").value =
            code;
    }

    /*
     * Server yangi roomga shu userId bilan
     * qayta ulaydi.
     */

    currentRoomCode = code;

    pendingAction = {
        type: "join-room",
        roomCode: code,
        userId:
            currentUserId || null,
        name: name
    };

    addSavedGroup(
        code,
        name
    );

    if (
        ws &&
        ws.readyState === WebSocket.OPEN
    ) {
        sendMessage(
            pendingAction
        );

        pendingAction = null;

    } else {
        connectWebSocket();
    }

    clearRoomError();
}


/* =========================================================
   LEAVE ROOM
   ========================================================= */

function leaveGroup() {
    if (
        ws &&
        ws.readyState === WebSocket.OPEN
    ) {
        sendMessage({
            type: "leave-room"
        });
    }

    stopLocationTracking();

    currentRoomCode = "";

    localStorage.removeItem(
        "gps-room-code"
    );

    users = [];

    clearMarkers();

    renderUsers();

    showSetup();

    setLocationStatus(
        "Joylashuv o‘chiq",
        false
    );
}


/* =========================================================
   GPS
   ========================================================= */

function startLocationTracking() {
    if (
        !navigator.geolocation
    ) {
        setLocationStatus(
            "GPS mavjud emas",
            false
        );

        return;
    }

    stopLocationTracking();

    setLocationStatus(
        "Joylashuv aniqlanmoqda...",
        false
    );


    watchId =
        navigator.geolocation.watchPosition(
            position => {

                const coords =
                    position.coords;

                const lat =
                    Number(
                        coords.latitude
                    );

                const lng =
                    Number(
                        coords.longitude
                    );

                const accuracy =
                    Number(
                        coords.accuracy
                    );


                if (
                    !Number.isFinite(lat) ||
                    !Number.isFinite(lng)
                ) {
                    return;
                }


                myLatitude = lat;
                myLongitude = lng;

                myAccuracy =
                    Number.isFinite(
                        accuracy
                    )
                        ? accuracy
                        : null;


                setLocationStatus(
                    myAccuracy !== null
                        ? `GPS faol • ±${Math.round(myAccuracy)} m`
                        : "GPS faol",
                    true
                );


                /*
                 * Serverga yuboramiz.
                 */

                if (
                    ws &&
                    ws.readyState === WebSocket.OPEN &&
                    currentRoomCode
                ) {
                    sendMessage({
                        type: "location",

                        lat: lat,

                        lng: lng,

                        accuracy:
                            myAccuracy
                    });
                }


                updateMyMarker();

                centerMapOnMyLocation(
                    false
                );
            },

            error => {
                console.error(
                    "GPS ERROR:",
                    error
                );

                let message =
                    "GPS aniqlanmadi.";

                if (
                    error.code ===
                    1
                ) {
                    message =
                        "Joylashuvga ruxsat berilmagan.";
                }

                if (
                    error.code ===
                    2
                ) {
                    message =
                        "Joylashuvni aniqlab bo‘lmadi.";
                }

                if (
                    error.code ===
                    3
                ) {
                    message =
                        "GPS vaqt tugadi.";
                }

                setLocationStatus(
                    message,
                    false
                );
            },

            {
                enableHighAccuracy:
                    true,

                maximumAge:
                    5000,

                timeout:
                    15000
            }
        );
}


function stopLocationTracking() {
    if (
        watchId !== null &&
        navigator.geolocation
    ) {
        navigator.geolocation.clearWatch(
            watchId
        );
    }

    watchId = null;
}


/* =========================================================
   MAP
   ========================================================= */

async function initMap() {
    if (mapInitialized) {
        return;
    }

    const mapElement =
        $("map");

    if (!mapElement) {
        return;
    }

    /*
     * Yandex Maps v3 script index.html ichida
     * yuklangan bo‘lishi kerak.
     */

    if (
        typeof ymaps3 ===
        "undefined"
    ) {
        console.warn(
            "Yandex Maps hali yuklanmagan."
        );

        return;
    }

    try {

        await ymaps3.ready;

        const {
            YMap,
            YMapDefaultSchemeLayer,
            YMapDefaultFeaturesLayer,
            YMapMarker
        } = ymaps3;


        map =
            new YMap(
                mapElement,
                {
                    location: {
                        center: [
                            69.2401,
                            41.2995
                        ],
                        zoom: 11
                    }
                }
            );


        map.addChild(
            new YMapDefaultSchemeLayer()
        );


        map.addChild(
            new YMapDefaultFeaturesLayer()
        );


        mapInitialized = true;

        console.log(
            "Yandex Map: ready"
        );

        updateMyMarker();
        updateMarkers();

    } catch (error) {
        console.error(
            "Yandex Map error:",
            error
        );
    }
}


/* =========================================================
   MARKER ELEMENT
   ========================================================= */

function createMarkerElement(
    user,
    isMe = false
) {
    const element =
        document.createElement(
            "div"
        );

    element.className =
        isMe
            ? "gps-marker gps-marker-me"
            : "gps-marker";


    element.innerHTML = `
        <div class="gps-marker-dot">
            ${isMe ? "📍" : "●"}
        </div>

        <div class="gps-marker-label">
            ${escapeHtml(
                user.name ||
                "Noma'lum"
            )}
        </div>
    `;

    return element;
}


/* =========================================================
   MY MARKER
   ========================================================= */

function updateMyMarker() {
    if (
        !mapInitialized ||
        !map ||
        typeof ymaps3 ===
        "undefined"
    ) {
        return;
    }

    if (
        !Number.isFinite(
            myLatitude
        ) ||
        !Number.isFinite(
            myLongitude
        )
    ) {
        return;
    }


    const {
        YMapMarker
    } = ymaps3;


    const position = [
        myLongitude,
        myLatitude
    ];


    const user = {
        id:
            currentUserId ||
            "me",

        name:
            currentUserName ||
            "Men",

        lat:
            myLatitude,

        lng:
            myLongitude
    };


    const element =
        createMarkerElement(
            user,
            true
        );


    try {

        if (myMarker) {
            map.removeChild(
                myMarker
            );
        }

        myMarker =
            new YMapMarker(
                {
                    coordinates:
                        position
                },
                element
            );

        map.addChild(
            myMarker
        );

    } catch (error) {
        console.error(
            "My marker error:",
            error
        );
    }
}


/* =========================================================
   OTHER MARKERS
   ========================================================= */

function updateMarkers() {
    if (
        !mapInitialized ||
        !map ||
        typeof ymaps3 ===
        "undefined"
    ) {
        return;
    }

    const {
        YMapMarker
    } = ymaps3;


    const activeIds =
        new Set();


    users.forEach(user => {

        if (!user) {
            return;
        }

        if (
            !user.id
        ) {
            return;
        }

        /*
         * O'zimizni alohida marker bilan
         * ko'rsatamiz.
         */

        if (
            currentUserId &&
            user.id === currentUserId
        ) {
            return;
        }


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


        activeIds.add(
            user.id
        );


        const position = [
            lng,
            lat
        ];


        try {

            if (
                userMarkers.has(
                    user.id
                )
            ) {
                const old =
                    userMarkers.get(
                        user.id
                    );

                map.removeChild(
                    old
                );
            }


            const element =
                createMarkerElement(
                    user,
                    false
                );


            const marker =
                new YMapMarker(
                    {
                        coordinates:
                            position
                    },
                    element
                );


            map.addChild(
                marker
            );


            userMarkers.set(
                user.id,
                marker
            );

        } catch (error) {
            console.error(
                "User marker error:",
                error
            );
        }
    });


    /*
     * Endi yo‘q foydalanuvchilar markerlarini
     * olib tashlaymiz.
     */

    for (
        const [
            id,
            marker
        ]
        of userMarkers
    ) {

        if (
            !activeIds.has(id)
        ) {

            try {
                map.removeChild(
                    marker
                );
            } catch {}

            userMarkers.delete(
                id
            );
        }
    }
}


/* =========================================================
   CLEAR MARKERS
   ========================================================= */

function clearMarkers() {
    if (
        map
    ) {
        if (myMarker) {
            try {
                map.removeChild(
                    myMarker
                );
            } catch {}
        }

        for (
            const marker
            of userMarkers.values()
        ) {
            try {
                map.removeChild(
                    marker
                );
            } catch {}
        }
    }

    myMarker = null;

    userMarkers.clear();
}


/* =========================================================
   CENTER MAP
   ========================================================= */

function centerMapOnMyLocation(
    force = true
) {
    if (
        !mapInitialized ||
        !map
    ) {
        return;
    }

    if (
        !Number.isFinite(
            myLatitude
        ) ||
        !Number.isFinite(
            myLongitude
        )
    ) {
        return;
    }

    try {

        map.setLocation({
            center: [
                myLongitude,
                myLatitude
            ],
            zoom: 16,
            duration: 500
        });

    } catch (error) {
        console.error(
            "Center map error:",
            error
        );
    }
}


/* =========================================================
   USERS UI
   ========================================================= */

function renderUsers() {
    const list =
        $("membersList");

    const count =
        $("membersCount");


    const onlineUsers =
        users.filter(
            user => user && user.online
        );


    if (count) {
        count.textContent =
            String(
                onlineUsers.length ||
                users.length
            );
    }


    if (!list) {
        return;
    }


    if (!users.length) {
        list.innerHTML = `
            <div class="empty-members">
                Guruhda hozircha foydalanuvchilar yo‘q.
            </div>
        `;

        return;
    }


    list.innerHTML =
        users.map(user => {

            const isMe =
                currentUserId &&
                user.id === currentUserId;


            const hasLocation =
                Number.isFinite(
                    Number(user.lat)
                ) &&
                Number.isFinite(
                    Number(user.lng)
                );


            return `
                <div class="member-item">
                    <div class="member-avatar">
                        ${isMe ? "📍" : "👤"}
                    </div>

                    <div class="member-info">
                        <strong>
                            ${escapeHtml(
                                user.name ||
                                "Noma'lum"
                            )}

                            ${
                                isMe
                                    ? `<small>(Siz)</small>`
                                    : ""
                            }
                        </strong>

                        <span>
                            ${
                                user.online
                                    ? "🟢 Online"
                                    : "⚪ Offline"
                            }

                            ${
                                hasLocation
                                    ? " • 📍 Joylashuv mavjud"
                                    : " • Joylashuv yo‘q"
                            }
                        </span>
                    </div>
                </div>
            `;
        }).join("");
}


/* =========================================================
   THEME
   ========================================================= */

function loadTheme() {
    const saved =
        localStorage.getItem(
            "gps-theme"
        );

    if (
        saved === "dark"
    ) {
        document.documentElement
            .classList.add("dark");

        document.body
            .classList.add("dark");
    } else {
        document.documentElement
            .classList.remove("dark");

        document.body
            .classList.remove("dark");
    }
}


function toggleTheme() {
    const dark =
        document.documentElement
            .classList.toggle("dark");

    document.body
        .classList.toggle(
            "dark",
            dark
        );

    localStorage.setItem(
        "gps-theme",
        dark
            ? "dark"
            : "light"
    );
}


/* =========================================================
   RESTORE SESSION
   ========================================================= */

function restoreSession() {
    const savedName =
        localStorage.getItem(
            "gps-user-name"
        ) || "";

    const savedRoom =
        normalizeRoomCode(
            localStorage.getItem(
                "gps-room-code"
            ) || ""
        );


    if (
        savedName &&
        $("userName")
    ) {
        $("userName").value =
            savedName;

        currentUserName =
            savedName;
    }


    if (
        savedRoom &&
        $("roomCode")
    ) {
        $("roomCode").value =
            savedRoom;

        currentRoomCode =
            savedRoom;
    }


    /*
     * F5 bo‘lganda eski guruhga avtomatik
     * qayta ulanadi.
     *
     * Bu server.js bilan mos:
     * userId + roomCode yuboriladi.
     */

    if (
        savedName &&
        isValidRoomCode(savedRoom)
    ) {

        pendingAction = {
            type: "join-room",

            roomCode:
                savedRoom,

            userId:
                currentUserId || null,

            name:
                savedName
        };

        showRoom();

        connectWebSocket();

    } else {
        showSetup();
    }
}


/* =========================================================
   INPUT EVENTS
   ========================================================= */

function setupInputEvents() {
    const roomInput =
        $("roomCode");

    if (roomInput) {

        roomInput.addEventListener(
            "input",
            () => {

                const normalized =
                    normalizeRoomCode(
                        roomInput.value
                    );

                roomInput.value =
                    normalized;

                clearRoomError();
            }
        );

        roomInput.addEventListener(
            "keydown",
            event => {

                if (
                    event.key ===
                    "Enter"
                ) {
                    event.preventDefault();

                    joinRoom();
                }
            }
        );
    }


    const nameInput =
        $("userName");

    if (nameInput) {

        nameInput.addEventListener(
            "input",
            () => {

                currentUserName =
                    normalizeName(
                        nameInput.value
                    );

                localStorage.setItem(
                    "gps-user-name",
                    currentUserName
                );
            }
        );
    }


    const switchInput =
        $("switchRoomInput");

    if (switchInput) {

        switchInput.addEventListener(
            "input",
            () => {

                switchInput.value =
                    normalizeRoomCode(
                        switchInput.value
                    );
            }
        );

        switchInput.addEventListener(
            "keydown",
            event => {

                if (
                    event.key ===
                    "Enter"
                ) {
                    event.preventDefault();

                    switchRoom();
                }
            }
        );
    }
}


/* =========================================================
   BUTTON EVENTS
   ========================================================= */

function setupButtonEvents() {

    const createButton =
        $("createRoomBtn");

    if (createButton) {
        createButton.addEventListener(
            "click",
            createRoom
        );
    }


    const joinButton =
        $("joinRoomBtn");

    if (joinButton) {
        joinButton.addEventListener(
            "click",
            joinRoom
        );
    }


    const copyButton =
        $("copyRoomBtn");

    if (copyButton) {
        copyButton.addEventListener(
            "click",
            copyRoomCode
        );
    }


    const switchButton =
        $("switchRoomBtn");

    if (switchButton) {
        switchButton.addEventListener(
            "click",
            switchRoom
        );
    }


    const leaveButton =
        $("leaveGroupBtn");

    if (leaveButton) {
        leaveButton.addEventListener(
            "click",
            leaveGroup
        );
    }


    const myLocationButton =
        $("myLocationBtn");

    if (myLocationButton) {
        myLocationButton.addEventListener(
            "click",
            () => {

                startLocationTracking();

                centerMapOnMyLocation(
                    true
                );
            }
        );
    }


    const centerButton =
        $("centerMapBtn");

    if (centerButton) {
        centerButton.addEventListener(
            "click",
            () => {

                centerMapOnMyLocation(
                    true
                );
            }
        );
    }


    const themeButton =
        $("themeBtn");

    if (themeButton) {
        themeButton.addEventListener(
            "click",
            toggleTheme
        );
    }
}


/* =========================================================
   PAGE INIT
   ========================================================= */

document.addEventListener(
    "DOMContentLoaded",
    async () => {

        console.log(
            "GPS CLIENT: starting..."
        );


        loadTheme();

        loadSavedGroups();

        setupInputEvents();

        setupButtonEvents();

        restoreSession();


        /*
         * Mapni biroz kechiktirib ishga tushiramiz.
         */

        setTimeout(
            () => {
                initMap();
            },
            300
        );
    }
);


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
                currentRoomCode &&
                (
                    !ws ||
                    ws.readyState !==
                    WebSocket.OPEN
                )
            ) {

                pendingAction = {
                    type:
                        "join-room",

                    roomCode:
                        currentRoomCode,

                    userId:
                        currentUserId ||
                        null,

                    name:
                        currentUserName ||
                        "Noma'lum"
                };

                connectWebSocket();
            }
        }
    }
);


/* =========================================================
   BEFORE UNLOAD
   ========================================================= */

window.addEventListener(
    "beforeunload",
    () => {

        /*
         * Bu yerda leave-room yubormaymiz.
         *
         * Chunki F5 qilganda server userni
         * offline qilib, keyin yangi socket
         * bilan qayta ulanishiga imkon berishi kerak.
         */
    }
);


/* =========================================================
   DEBUG
   ========================================================= */

window.GPS_DEBUG = {
    get userId() {
        return currentUserId;
    },

    get userName() {
        return currentUserName;
    },

    get roomCode() {
        return currentRoomCode;
    },

    get users() {
        return users;
    },

    get websocketState() {
        return ws
            ? ws.readyState
            : null;
    },

    reconnect() {
        pendingAction = {
            type:
                "join-room",

            roomCode:
                currentRoomCode,

            userId:
                currentUserId ||
                null,

            name:
                currentUserName ||
                "Noma'lum"
        };

        connectWebSocket();
    }
};


console.log(
    "GPS CLIENT: loaded"
);
