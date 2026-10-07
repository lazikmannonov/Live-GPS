"use strict";

// =====================================================
// STORAGE
// =====================================================

const STORAGE_USER_NAME = "live-gps-user-name";
const STORAGE_ROOM_CODE = "live-gps-room-code";
const STORAGE_USER_ID = "live-gps-user-id";
const STORAGE_THEME = "live-gps-theme";
const STORAGE_SAVED_GROUPS = "live-gps-saved-groups";

// =====================================================
// DOM
// =====================================================

let setupCard;
let roomCard;

let nameInput;
let roomCodeInput;

let createRoomBtn;
let joinRoomBtn;

let currentRoomCode;
let copyRoomBtn;
let copyRoomText;

let connectionStatus;
let locationStatus;

let connectionPill;
let connectionText;

let membersList;
let memberCount;

let switchRoomInput;
let switchRoomBtn;

let themeBtn;
let themeIcon;

let setupError;
let roomError;

let myLocationBtn;
let mapResetBtn;

// =====================================================
// STATE
// =====================================================

let socket = null;

let myUserId = null;
let currentName = "";
let currentRoom = "";

let reconnectTimer = null;
let reconnectDelay = 1000;

let watchId = null;

let map = null;
let lightTile = null;

const markers = new Map();
const accuracyCircles = new Map();

let currentPosition = null;
let lastUsers = [];

let isRestoring = false;
let locationStarted = false;
let hasCenteredOnOwnLocation = false;

// =====================================================
// DOM READY
// =====================================================

document.addEventListener(
    "DOMContentLoaded",
    function() {
        cacheDom();

        loadTheme();
        loadSavedUser();
        renderSavedGroups();
        bindEvents();
        connectWebSocket();
    }
);

// =====================================================
// CACHE DOM
// =====================================================

function cacheDom() {
    setupCard =
        document.getElementById(
            "setupCard"
        );

    roomCard =
        document.getElementById(
            "roomCard"
        );

    nameInput =
        document.getElementById(
            "nameInput"
        );

    roomCodeInput =
        document.getElementById(
            "roomCodeInput"
        );

    createRoomBtn =
        document.getElementById(
            "createRoomBtn"
        );

    joinRoomBtn =
        document.getElementById(
            "joinRoomBtn"
        );

    currentRoomCode =
        document.getElementById(
            "currentRoomCode"
        );

    copyRoomBtn =
        document.getElementById(
            "copyRoomBtn"
        );

    copyRoomText =
        document.getElementById(
            "copyRoomText"
        );

    connectionStatus =
        document.getElementById(
            "connectionStatus"
        );

    locationStatus =
        document.getElementById(
            "locationStatus"
        );

    connectionPill =
        document.getElementById(
            "connectionPill"
        );

    connectionText =
        document.getElementById(
            "connectionText"
        );

    membersList =
        document.getElementById(
            "membersList"
        );

    memberCount =
        document.getElementById(
            "memberCount"
        );

    switchRoomInput =
        document.getElementById(
            "switchRoomInput"
        );

    switchRoomBtn =
        document.getElementById(
            "switchRoomBtn"
        );

    themeBtn =
        document.getElementById(
            "themeBtn"
        );

    themeIcon =
        document.getElementById(
            "themeIcon"
        );

    setupError =
        document.getElementById(
            "setupError"
        );

    roomError =
        document.getElementById(
            "roomError"
        );

    myLocationBtn =
        document.getElementById(
            "myLocationBtn"
        );

    mapResetBtn =
        document.getElementById(
            "mapResetBtn"
        );
}

// =====================================================
// EVENTS
// =====================================================

function bindEvents() {
    if (createRoomBtn) {
        createRoomBtn.addEventListener(
            "click",
            createRoom
        );
    }

    if (joinRoomBtn) {
        joinRoomBtn.addEventListener(
            "click",
            joinRoom
        );
    }

    if (copyRoomBtn) {
        copyRoomBtn.addEventListener(
            "click",
            copyRoomCode
        );
    }

    if (switchRoomBtn) {
        switchRoomBtn.addEventListener(
            "click",
            switchToAnotherRoom
        );
    }

    if (themeBtn) {
        themeBtn.addEventListener(
            "click",
            toggleTheme
        );
    }

    if (myLocationBtn) {
        myLocationBtn.addEventListener(
            "click",
            centerOnMyLocation
        );
    }

    if (mapResetBtn) {
        mapResetBtn.addEventListener(
            "click",
            resetMap
        );
    }

    if (roomCodeInput) {
        roomCodeInput.addEventListener(
            "input",
            function() {
                roomCodeInput.value =
                    roomCodeInput.value
                        .toUpperCase()
                        .replace(
                            /[^A-Z0-9]/g,
                            ""
                        )
                        .slice(0, 6);
            }
        );

        roomCodeInput.addEventListener(
            "keydown",
            function(event) {
                if (
                    event.key === "Enter"
                ) {
                    joinRoom();
                }
            }
        );
    }

    if (nameInput) {
        nameInput.addEventListener(
            "keydown",
            function(event) {
                if (
                    event.key === "Enter"
                ) {
                    createRoom();
                }
            }
        );
    }

    if (switchRoomInput) {
        switchRoomInput.addEventListener(
            "input",
            function() {
                switchRoomInput.value =
                    switchRoomInput.value
                        .toUpperCase()
                        .replace(
                            /[^A-Z0-9]/g,
                            ""
                        )
                        .slice(0, 6);
            }
        );

        switchRoomInput.addEventListener(
            "keydown",
            function(event) {
                if (
                    event.key === "Enter"
                ) {
                    switchToAnotherRoom();
                }
            }
        );
    }
}

// =====================================================
// USER
// =====================================================

function loadSavedUser() {
    const savedName =
        localStorage.getItem(
            STORAGE_USER_NAME
        );

    const savedUserId =
        localStorage.getItem(
            STORAGE_USER_ID
        );

    const savedRoom =
        localStorage.getItem(
            STORAGE_ROOM_CODE
        );

    if (savedName) {
        currentName = savedName;

        if (nameInput) {
            nameInput.value = savedName;
        }
    }

    if (savedUserId) {
        myUserId = savedUserId;
    }

    if (savedRoom && roomCodeInput) {
        roomCodeInput.value =
            savedRoom;
    }
}

// =====================================================
// SAVED GROUPS
// =====================================================

function getSavedGroups() {
    try {
        const raw =
            localStorage.getItem(
                STORAGE_SAVED_GROUPS
            );

        if (!raw) {
            return [];
        }

        const groups =
            JSON.parse(raw);

        if (!Array.isArray(groups)) {
            return [];
        }

        return groups;
    } catch (error) {
        return [];
    }
}

function saveSavedGroups(groups) {
    localStorage.setItem(
        STORAGE_SAVED_GROUPS,
        JSON.stringify(groups)
    );
}

function saveCurrentGroup() {
    if (!currentRoom) {
        return;
    }

    const code =
        currentRoom
            .trim()
            .toUpperCase();

    if (!code) {
        return;
    }

    const name =
        currentName ||
        "Guruh";

    let groups =
        getSavedGroups();

    groups = groups.filter(
        function(group) {
            return (
                group &&
                group.code !== code
            );
        }
    );

    groups.unshift({
        code: code,
        name: name,
        savedAt: Date.now()
    });

    // Bir qurilmada maksimal 10 ta
    // saqlangan guruh.
    groups =
        groups.slice(0, 10);

    saveSavedGroups(groups);

    renderSavedGroups();
}

function removeSavedGroup(code) {
    let groups =
        getSavedGroups();

    groups = groups.filter(
        function(group) {
            return (
                group.code !== code
            );
        }
    );

    saveSavedGroups(groups);

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

    if (!setupCard) {
        return;
    }

    const groups =
        getSavedGroups();

    if (!groups.length) {
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
        <div class="saved-groups-header">
            <div>
                <div class="saved-groups-title">
                    Saqlangan guruhlar
                </div>

                <div class="saved-groups-subtitle">
                    Keyinroq yana shu guruhlarga kirishingiz mumkin
                </div>
            </div>

            <div class="saved-groups-icon">
                ★
            </div>
        </div>

        <div class="saved-groups-list">
            ${groups.map(function(group) {
                return `
                    <div
                        class="saved-group-item"
                        data-room-code="${escapeHtml(group.code)}"
                    >
                        <button
                            type="button"
                            class="saved-group-main"
                            data-action="join-saved"
                            data-code="${escapeHtml(group.code)}"
                        >
                            <span class="saved-group-room-icon">
                                📍
                            </span>

                            <span class="saved-group-info">
                                <strong>
                                    ${escapeHtml(
                                        group.name ||
                                        "Guruh"
                                    )}
                                </strong>

                                <small>
                                    ${escapeHtml(
                                        group.code
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
                            data-action="delete-saved"
                            data-code="${escapeHtml(group.code)}"
                            title="Saqlangan guruhni o'chirish"
                        >
                            ×
                        </button>
                    </div>
                `;
            }).join("")}
        </div>
    `;

    setupCard.appendChild(section);

    section.addEventListener(
        "click",
        function(event) {
            const target =
                event.target.closest(
                    "[data-action]"
                );

            if (!target) {
                return;
            }

            const action =
                target.dataset.action;

            const code =
                target.dataset.code;

            if (
                action ===
                "join-saved"
            ) {
                joinSavedGroup(code);
            }

            if (
                action ===
                "delete-saved"
            ) {
                removeSavedGroup(code);
            }
        }
    );
}

// =====================================================
// JOIN SAVED GROUP
// =====================================================

function joinSavedGroup(code) {
    if (!code) {
        return;
    }

    if (roomCodeInput) {
        roomCodeInput.value =
            code;
    }

    clearErrors();

    const groups =
        getSavedGroups();

    const group =
        groups.find(
            function(item) {
                return (
                    item.code ===
                    code
                );
            }
        );

    if (
        group &&
        group.name &&
        nameInput &&
        !nameInput.value.trim()
    ) {
        nameInput.value =
            group.name;
    }

    joinRoom();
}

// =====================================================
// ESCAPE HTML
// =====================================================

function escapeHtml(value) {
    return String(value || "")
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

// =====================================================
// WEBSOCKET
// =====================================================

function getWebSocketUrl() {
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
        socket &&
        (
            socket.readyState ===
                WebSocket.OPEN ||
            socket.readyState ===
                WebSocket.CONNECTING
        )
    ) {
        return;
    }

    updateConnectionUI(
        false,
        "Ulanmoqda..."
    );

    try {
        socket =
            new WebSocket(
                getWebSocketUrl()
            );
    } catch (error) {
        scheduleReconnect();
        return;
    }

    socket.addEventListener(
        "open",
        function() {
            reconnectDelay = 1000;

            updateConnectionUI(
                true,
                "Ulangan"
            );

            restoreSession();
        }
    );

    socket.addEventListener(
        "message",
        function(event) {
            handleSocketMessage(
                event.data
            );
        }
    );

    socket.addEventListener(
        "close",
        function() {
            updateConnectionUI(
                false,
                "Ulanish uzildi"
            );

            scheduleReconnect();
        }
    );

    socket.addEventListener(
        "error",
        function() {
            updateConnectionUI(
                false,
                "Ulanishda xato"
            );
        }
    );
}

// =====================================================
// SOCKET MESSAGE
// =====================================================

function handleSocketMessage(raw) {
    let data;

    try {
        data =
            JSON.parse(raw);
    } catch (error) {
        return;
    }

    // ==============================================
    // CONNECTED
    // ==============================================

    if (
        data.type ===
        "connected"
    ) {
        const savedUserId =
            localStorage.getItem(
                STORAGE_USER_ID
            );

        if (savedUserId) {
            myUserId =
                savedUserId;
        } else if (data.id) {
            myUserId =
                data.id;

            localStorage.setItem(
                STORAGE_USER_ID,
                myUserId
            );
        }

        return;
    }

    // ==============================================
    // ROOM CREATED
    // ==============================================

    if (
        data.type ===
        "room-created"
    ) {
        currentRoom =
            String(
                data.roomCode || ""
            )
                .trim()
                .toUpperCase();

        if (data.userId) {
            myUserId =
                data.userId;

            localStorage.setItem(
                STORAGE_USER_ID,
                myUserId
            );
        }

        localStorage.setItem(
            STORAGE_ROOM_CODE,
            currentRoom
        );

        saveCurrentGroup();

        showRoom();

        return;
    }

    // ==============================================
    // JOINED ROOM
    // ==============================================

    if (
        data.type ===
        "joined-room"
    ) {
        currentRoom =
            String(
                data.roomCode || ""
            )
                .trim()
                .toUpperCase();

        if (data.userId) {
            myUserId =
                data.userId;

            localStorage.setItem(
                STORAGE_USER_ID,
                myUserId
            );
        }

        localStorage.setItem(
            STORAGE_ROOM_CODE,
            currentRoom
        );

        saveCurrentGroup();

        showRoom();

        // Qayta kirganda eski GPS
        // koordinatasini darhol yuborish.
        setTimeout(
            function() {
                sendCurrentPosition();
            },
            300
        );

        return;
    }

    // ==============================================
    // USERS
    // ==============================================

    if (
        data.type ===
        "users"
    ) {
        if (
            Array.isArray(
                data.users
            )
        ) {
            lastUsers =
                data.users;

            renderUsers();
        }

        return;
    }

    // ==============================================
    // LEFT ROOM
    // ==============================================

    if (
        data.type ===
        "left-room"
    ) {
        currentRoom = "";

        localStorage.removeItem(
            STORAGE_ROOM_CODE
        );

        stopLocationSharing();
        clearMarkers();

        showSetup();

        return;
    }

    // ==============================================
    // ERROR
    // ==============================================

    if (
        data.type ===
        "error"
    ) {
        handleServerError(
            data.message
        );

        return;
    }
}

// =====================================================
// RESTORE SESSION
// =====================================================

function restoreSession() {
    if (isRestoring) {
        return;
    }

    const savedRoom =
        localStorage.getItem(
            STORAGE_ROOM_CODE
        );

    const savedName =
        localStorage.getItem(
            STORAGE_USER_NAME
        );

    const savedUserId =
        localStorage.getItem(
            STORAGE_USER_ID
        );

    if (
        !savedRoom ||
        !savedName
    ) {
        return;
    }

    if (
        !socket ||
        socket.readyState !==
            WebSocket.OPEN
    ) {
        return;
    }

    isRestoring = true;

    currentName =
        savedName;

    myUserId =
        savedUserId ||
        myUserId;

    send({
        type: "join-room",
        roomCode: savedRoom,
        name: savedName,
        userId: myUserId
    });

    setTimeout(
        function() {
            isRestoring = false;
        },
        5000
    );
}

// =====================================================
// CREATE ROOM
// =====================================================

function createRoom() {
    clearErrors();

    const name =
        String(
            nameInput
                ? nameInput.value
                : ""
        )
            .trim();

    if (!name) {
        showSetupError(
            "Ismingizni kiriting."
        );

        if (nameInput) {
            nameInput.focus();
        }

        return;
    }

    if (!isSocketReady()) {
        showSetupError(
            "Serverga ulanilmoqda. Biroz kuting."
        );

        return;
    }

    currentName =
        name.slice(0, 30);

    localStorage.setItem(
        STORAGE_USER_NAME,
        currentName
    );

    send({
        type: "create-room",
        name: currentName,
        userId: myUserId
    });

    setButtonLoading(
        createRoomBtn,
        true
    );

    setTimeout(
        function() {
            setButtonLoading(
                createRoomBtn,
                false
            );
        },
        1000
    );
}

// =====================================================
// JOIN ROOM
// =====================================================

function joinRoom() {
    clearErrors();

    const name =
        String(
            nameInput
                ? nameInput.value
                : ""
        )
            .trim();

    const code =
        String(
            roomCodeInput
                ? roomCodeInput.value
                : ""
        )
            .trim()
            .toUpperCase();

    if (!name) {
        showSetupError(
            "Ismingizni kiriting."
        );

        if (nameInput) {
            nameInput.focus();
        }

        return;
    }

    if (code.length !== 6) {
        showSetupError(
            "Guruh kodi 6 ta belgidan iborat bo'lishi kerak."
        );

        if (roomCodeInput) {
            roomCodeInput.focus();
        }

        return;
    }

    if (!isSocketReady()) {
        showSetupError(
            "Serverga ulanilmoqda. Biroz kuting."
        );

        return;
    }

    currentName =
        name.slice(0, 30);

    localStorage.setItem(
        STORAGE_USER_NAME,
        currentName
    );

    send({
        type: "join-room",
        roomCode: code,
        name: currentName,
        userId: myUserId
    });

    setButtonLoading(
        joinRoomBtn,
        true
    );

    setTimeout(
        function() {
            setButtonLoading(
                joinRoomBtn,
                false
            );
        },
        1000
    );
}

// =====================================================
// SWITCH ROOM
// =====================================================

function switchToAnotherRoom() {
    const code =
        String(
            switchRoomInput
                ? switchRoomInput.value
                : ""
        )
            .trim()
            .toUpperCase();

    if (code.length !== 6) {
        showRoomError(
            "Guruh kodi 6 ta belgidan iborat bo'lishi kerak."
        );

        return;
    }

    if (!isSocketReady()) {
        showRoomError(
            "Server bilan aloqa yo'q."
        );

        return;
    }

    clearRoomError();

    // Eski markerlarni tozalaymiz.
    // Yangi guruhdan yangi koordinata olinadi.
    clearMarkers();

    send({
        type: "join-room",
        roomCode: code,
        name: currentName,
        userId: myUserId
    });
}

// =====================================================
// SEND
// =====================================================

function send(data) {
    if (
        !socket ||
        socket.readyState !==
            WebSocket.OPEN
    ) {
        return false;
    }

    try {
        socket.send(
            JSON.stringify(data)
        );

        return true;
    } catch (error) {
        return false;
    }
}

function isSocketReady() {
    return (
        socket &&
        socket.readyState ===
            WebSocket.OPEN
    );
}

// =====================================================
// SHOW ROOM
// =====================================================

function showRoom() {
    if (setupCard) {
        setupCard.classList.add("hidden");
        setupCard.style.display = "none";
    }

    if (roomCard) {
        // MUHIM: hidden klassini olib tashlaymiz
        roomCard.classList.remove("hidden");
        roomCard.style.display = "block";
    }

    if (currentRoomCode) {
        currentRoomCode.textContent =
            currentRoom;
    }

    if (switchRoomInput) {
        switchRoomInput.value = "";
    }

    initMap();

    if (map) {
        setTimeout(function() {
            map.invalidateSize();
        }, 100);
    }

    startLocationSharing();

    updateLocationUI(
        "Joylashuv olinmoqda..."
    );
}


// =====================================================
// SHOW SETUP
// =====================================================

function showSetup() {
    if (setupCard) {
        setupCard.classList.remove("hidden");
        setupCard.style.display = "";
    }

    if (roomCard) {
        roomCard.classList.add("hidden");
        roomCard.style.display = "none";
    }

    stopLocationSharing();
    clearMarkers();

    renderSavedGroups();
}

// =====================================================
// MAP
// =====================================================

function initMap() {
    if (map) {
        return;
    }

    if (
        typeof L ===
        "undefined"
    ) {
        console.error(
            "Leaflet topilmadi."
        );

        showRoomError(
            "Xarita yuklanmadi. Leaflet kutubxonasini tekshiring."
        );

        return;
    }

    const mapElement =
        document.getElementById(
            "map"
        );

    if (!mapElement) {
        return;
    }

    map =
        L.map(
            mapElement,
            {
                zoomControl: true,
                attributionControl: true
            }
        ).setView(
            [41.3111, 69.2797],
            12
        );

    lightTile =
        L.tileLayer(
            "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png",
            {
                maxZoom: 19,
                attribution:
                    "&copy; OpenStreetMap contributors"
            }
        );

    lightTile.addTo(map);

    setTimeout(
        function() {
            map.invalidateSize();
        },
        200
    );
}

// =====================================================
// GPS
// =====================================================

function startLocationSharing() {
    if (locationStarted) {
        return;
    }

    if (
        !navigator.geolocation
    ) {
        updateLocationUI(
            "GPS qo'llab-quvvatlanmaydi"
        );

        return;
    }

    locationStarted = true;

    watchId =
        navigator.geolocation.watchPosition(
            handlePosition,
            handleLocationError,
            {
                enableHighAccuracy: true,
                maximumAge: 5000,
                timeout: 15000
            }
        );
}

function stopLocationSharing() {
    if (
        watchId !== null
    ) {
        try {
            navigator.geolocation.clearWatch(
                watchId
            );
        } catch (error) {
            // ignore
        }
    }

    watchId = null;
    locationStarted = false;
}

function handlePosition(position) {
    const coords =
        position.coords;

    currentPosition = {
        lat: coords.latitude,
        lng: coords.longitude,
        accuracy:
            coords.accuracy || 0
    };

    updateLocationUI(
        "Joylashuv aniqlandi"
    );

    updateMyMarker();

    sendCurrentPosition();

    if (
        !hasCenteredOnOwnLocation
    ) {
        hasCenteredOnOwnLocation =
            true;

        if (map) {
            map.setView(
                [
                    currentPosition.lat,
                    currentPosition.lng
                ],
                16,
                {
                    animate: true
                }
            );
        }
    }
}

function sendCurrentPosition() {
    if (
        !currentPosition ||
        !currentRoom ||
        !isSocketReady()
    ) {
        return;
    }

    send({
        type: "location",
        lat: currentPosition.lat,
        lng: currentPosition.lng,
        accuracy:
            currentPosition.accuracy
    });
}

function handleLocationError(error) {
    let message =
        "GPS xatosi";

    if (error) {
        if (
            error.code ===
            1
        ) {
            message =
                "GPS ruxsati berilmadi";
        } else if (
            error.code ===
            2
        ) {
            message =
                "Joylashuv aniqlanmadi";
        } else if (
            error.code ===
            3
        ) {
            message =
                "GPS vaqti tugadi";
        }
    }

    updateLocationUI(
        message
    );
}

// =====================================================
// USERS RENDER
// =====================================================

function renderUsers() {
    renderMemberList();
    renderUserMarkers();
}

// =====================================================
// MARKER ICON
// =====================================================

function createMarkerIcon(
    isMe,
    online
) {
    const opacity =
        online
            ? "1"
            : "0.5";

    const filter =
        online
            ? "none"
            : "grayscale(1)";

    const label =
        isMe
            ? "Siz"
            : "";

    return L.divIcon({
        className:
            "custom-gps-icon",

        html: `
            <div
                class="gps-marker ${isMe ? "me" : "other"}"
                style="
                    opacity:${opacity};
                    filter:${filter};
                    position:relative;
                "
            >
                <div class="gps-marker-dot"></div>

                ${
                    label
                        ? `
                            <div
                                style="
                                    position:absolute;
                                    top:-23px;
                                    left:50%;
                                    transform:translateX(-50%);
                                    white-space:nowrap;
                                    font-size:11px;
                                    font-weight:700;
                                    background:#111;
                                    color:#fff;
                                    padding:3px 7px;
                                    border-radius:8px;
                                "
                            >
                                Siz
                            </div>
                        `
                        : ""
                }
            </div>
        `,

        iconSize: [
            34,
            34
        ],

        iconAnchor: [
            17,
            17
        ],

        popupAnchor: [
            0,
            -18
        ]
    });
}

// =====================================================
// MY MARKER
// =====================================================

function updateMyMarker() {
    if (
        !map ||
        !currentPosition
    ) {
        return;
    }

    const lat =
        currentPosition.lat;

    const lng =
        currentPosition.lng;

    const existing =
        markers.get("me");

    const icon =
        createMarkerIcon(
            true,
            true
        );

    if (existing) {
        existing.setLatLng([
            lat,
            lng
        ]);

        existing.setIcon(
            icon
        );
    } else {
        const marker =
            L.marker(
                [
                    lat,
                    lng
                ],
                {
                    icon:
                        icon,
                    zIndexOffset:
                        1000
                }
            );

        marker.bindPopup(
            `
                <div>
                    <strong>Siz</strong>
                    <br>
                    <span>
                        Hozirgi joylashuv
                    </span>
                </div>
            `
        );

        marker.addTo(map);

        markers.set(
            "me",
            marker
        );
    }

    let circle =
        accuracyCircles.get(
            "me"
        );

    if (!circle) {
        circle =
            L.circle(
                [
                    lat,
                    lng
                ],
                {
                    radius:
                        currentPosition.accuracy ||
                        20,
                    color:
                        "#19d66b",
                    fillColor:
                        "#19d66b",
                    fillOpacity:
                        0.12,
                    weight:
                        1
                }
            ).addTo(
                map
            );

        accuracyCircles.set(
            "me",
            circle
        );
    } else {
        circle.setLatLng([
            lat,
            lng
        ]);

        circle.setRadius(
            currentPosition.accuracy ||
                20
        );
    }
}

// =====================================================
// USER MARKERS
// =====================================================

function renderUserMarkers() {
    if (!map) {
        return;
    }

    const activeIds =
        new Set();

    // O'z markerimiz doim qoladi.
    activeIds.add("me");

    for (
        const user of lastUsers
    ) {
        if (!user || !user.id) {
            continue;
        }

        // User ro'yxatda qolsa,
        // uning eski markerini ham
        // darhol o'chirmaymiz.
        activeIds.add(
            user.id
        );

        // O'z markerimiz serverdan
        // kelgani bilan almashtirilmaydi.
        if (
            user.id ===
            myUserId
        ) {
            continue;
        }

        if (
            !Number.isFinite(
                Number(user.lat)
            ) ||
            !Number.isFinite(
                Number(user.lng)
            )
        ) {
            continue;
        }

        const lat =
            Number(user.lat);

        const lng =
            Number(user.lng);

        const online =
            Boolean(
                user.online
            );

        const icon =
            createMarkerIcon(
                false,
                online
            );

        let marker =
            markers.get(
                user.id
            );

        if (!marker) {
            marker =
                L.marker(
                    [
                        lat,
                        lng
                    ],
                    {
                        icon:
                            icon
                    }
                );

            marker.addTo(
                map
            );

            markers.set(
                user.id,
                marker
            );
        } else {
            marker.setLatLng([
                lat,
                lng
            ]);

            marker.setIcon(
                icon
            );
        }

        marker.bindPopup(
            createPopupContent(
                user
            )
        );

        let circle =
            accuracyCircles.get(
                user.id
            );

        const accuracy =
            Number(
                user.accuracy
            ) || 0;

        if (accuracy > 0) {
            if (!circle) {
                circle =
                    L.circle(
                        [
                            lat,
                            lng
                        ],
                        {
                            radius:
                                accuracy,
                            color:
                                online
                                    ? "#19d66b"
                                    : "#888",
                            fillColor:
                                online
                                    ? "#19d66b"
                                    : "#888",
                            fillOpacity:
                                online
                                    ? 0.08
                                    : 0.04,
                            weight:
                                1
                        }
                    ).addTo(
                        map
                    );

                accuracyCircles.set(
                    user.id,
                    circle
                );
            } else {
                circle.setLatLng([
                    lat,
                    lng
                ]);

                circle.setRadius(
                    accuracy
                );
            }
        }
    }

    // Endi ro'yxatda umuman yo'q
    // userlarning markerlarini o'chiramiz.
    for (
        const [
            id,
            marker
        ] of markers
    ) {
        if (
            id === "me"
        ) {
            continue;
        }

        if (
            !activeIds.has(id)
        ) {
            try {
                map.removeLayer(
                    marker
                );
            } catch (error) {
                // ignore
            }

            markers.delete(id);
        }
    }

    for (
        const [
            id,
            circle
        ] of accuracyCircles
    ) {
        if (
            id === "me"
        ) {
            continue;
        }

        if (
            !activeIds.has(id)
        ) {
            try {
                map.removeLayer(
                    circle
                );
            } catch (error) {
                // ignore
            }

            accuracyCircles.delete(
                id
            );
        }
    }
}

// =====================================================
// POPUP
// =====================================================

function createPopupContent(
    user
) {
    const online =
        Boolean(
            user.online
        );

    const status =
        online
            ? "Online"
            : "Offline";

    const statusColor =
        online
            ? "#19d66b"
            : "#888";

    const accuracy =
        Number(
            user.accuracy
        );

    let extra = "";

    if (
        Number.isFinite(
            accuracy
        ) &&
        accuracy > 0
    ) {
        extra += `
            <div style="margin-top:4px">
                Aniqlik: ±${Math.round(
                    accuracy
                )} m
            </div>
        `;
    }

    if (!online) {
        extra += `
            <div
                style="
                    margin-top:6px;
                    opacity:.75;
                "
            >
                Oxirgi joylashuv saqlangan
            </div>
        `;
    }

    return `
        <div
            style="
                min-width:150px;
                line-height:1.45;
            "
        >
            <strong>
                ${escapeHtml(
                    user.name ||
                    "Foydalanuvchi"
                )}
            </strong>

            <div
                style="
                    margin-top:5px;
                    color:${statusColor};
                    font-weight:700;
                "
            >
                ● ${status}
            </div>

            ${extra}
        </div>
    `;
}

// =====================================================
// MEMBER LIST
// =====================================================

function renderMemberList() {
    if (!membersList) {
        return;
    }

    if (memberCount) {
        memberCount.textContent =
            String(
                lastUsers.length
            );
    }

    if (!lastUsers.length) {
        membersList.innerHTML = `
            <div
                style="
                    padding:18px;
                    text-align:center;
                    opacity:.65;
                "
            >
                Hozircha guruhda hech kim yo'q.
            </div>
        `;

        return;
    }

    membersList.innerHTML =
        lastUsers.map(
            function(user) {
                const isMe =
                    user.id ===
                    myUserId;

                const online =
                    Boolean(
                        user.online
                    );

                const hasCoords =
                    Number.isFinite(
                        Number(
                            user.lat
                        )
                    ) &&
                    Number.isFinite(
                        Number(
                            user.lng
                        )
                    );

                let distanceText =
                    "";

                if (
                    isMe
                ) {
                    distanceText =
                        online
                            ? "Sizning joylashuvingiz"
                            : "Offline";
                } else if (
                    hasCoords &&
                    currentPosition
                ) {
                    const distance =
                        calculateDistance(
                            currentPosition.lat,
                            currentPosition.lng,
                            Number(
                                user.lat
                            ),
                            Number(
                                user.lng
                            )
                        );

                    if (online) {
                        distanceText =
                            formatDistance(
                                distance
                            );
                    } else {
                        distanceText =
                            "Offline • " +
                            formatDistance(
                                distance
                            );
                    }
                } else if (
                    online
                ) {
                    distanceText =
                        "Joylashuv kutilmoqda";
                } else {
                    distanceText =
                        "Offline • joylashuv saqlangan";
                }

                const statusClass =
                    online
                        ? "online"
                        : "";

                return `
                    <div class="member">
                        <div class="member-avatar">
                            ${escapeHtml(
                                (
                                    user.name ||
                                    "F"
                                )
                                    .charAt(0)
                                    .toUpperCase()
                            )}
                        </div>

                        <div class="member-info">
                            <div class="member-name">
                                ${escapeHtml(
                                    user.name ||
                                    "Foydalanuvchi"
                                )}

                                ${
                                    isMe
                                        ? `
                                            <span
                                                style="
                                                    opacity:.6;
                                                    font-size:11px;
                                                "
                                            >
                                                (Siz)
                                            </span>
                                        `
                                        : ""
                                }
                            </div>

                            <div class="member-distance">
                                ${escapeHtml(
                                    distanceText
                                )}
                            </div>
                        </div>

                        <div
                            class="member-status ${statusClass}"
                            title="${
                                online
                                    ? "Online"
                                    : "Offline"
                            }"
                        ></div>
                    </div>
                `;
            }
        ).join("");
}

// =====================================================
// DISTANCE
// =====================================================

function calculateDistance(
    lat1,
    lon1,
    lat2,
    lon2
) {
    const R = 6371000;

    const dLat =
        toRadians(
            lat2 - lat1
        );

    const dLon =
        toRadians(
            lon2 - lon1
        );

    const a =
        Math.sin(
            dLat / 2
        ) *
            Math.sin(
                dLat / 2
            ) +
        Math.cos(
            toRadians(lat1)
        ) *
            Math.cos(
                toRadians(lat2)
            ) *
            Math.sin(
                dLon / 2
            ) *
            Math.sin(
                dLon / 2
            );

    const c =
        2 *
        Math.atan2(
            Math.sqrt(a),
            Math.sqrt(
                1 - a
            )
        );

    return R * c;
}

function toRadians(
    value
) {
    return (
        value *
        Math.PI /
        180
    );
}

function formatDistance(
    meters
) {
    if (
        meters < 1000
    ) {
        return (
            Math.round(
                meters
            ) +
            " m"
        );
    }

    return (
        (
            meters /
            1000
        ).toFixed(1) +
        " km"
    );
}

// =====================================================
// CENTER MY LOCATION
// =====================================================

function centerOnMyLocation() {
    if (
        !map ||
        !currentPosition
    ) {
        updateLocationUI(
            "Hozircha joylashuv topilmadi"
        );

        return;
    }

    map.setView(
        [
            currentPosition.lat,
            currentPosition.lng
        ],
        17,
        {
            animate: true
        }
    );

    const marker =
        markers.get(
            "me"
        );

    if (marker) {
        marker.openPopup();
    }
}

// =====================================================
// RESET MAP
// =====================================================

function resetMap() {
    if (
        !map
    ) {
        return;
    }

    if (
        currentPosition
    ) {
        map.setView(
            [
                currentPosition.lat,
                currentPosition.lng
            ],
            16,
            {
                animate: true
            }
        );

        return;
    }

    map.setView(
        [
            41.3111,
            69.2797
        ],
        12,
        {
            animate: true
        }
    );
}

// =====================================================
// COPY ROOM CODE
// =====================================================

async function copyRoomCode() {
    if (!currentRoom) {
        return;
    }

    try {
        await navigator.clipboard.writeText(
            currentRoom
        );

        if (copyRoomText) {
            const oldText =
                copyRoomText.textContent;

            copyRoomText.textContent =
                "Nusxalandi!";

            setTimeout(
                function() {
                    copyRoomText.textContent =
                        oldText;
                },
                1500
            );
        }

    } catch (error) {
        // Eski browser fallback
        const textarea =
            document.createElement(
                "textarea"
            );

        textarea.value =
            currentRoom;

        document.body.appendChild(
            textarea
        );

        textarea.select();

        try {
            document.execCommand(
                "copy"
            );
        } catch (copyError) {
            // ignore
        }

        textarea.remove();

        if (copyRoomText) {
            copyRoomText.textContent =
                "Nusxalandi!";

            setTimeout(
                function() {
                    copyRoomText.textContent =
                        "Nusxalash";
                },
                1500
            );
        }
    }
}

// =====================================================
// THEME
// =====================================================

function loadTheme() {
    const theme =
        localStorage.getItem(
            STORAGE_THEME
        ) ||
        "light";

    applyTheme(
        theme
    );
}

function toggleTheme() {
    const current =
        document.body.classList.contains(
            "dark"
        )
            ? "dark"
            : "light";

    const next =
        current === "dark"
            ? "light"
            : "dark";

    applyTheme(
        next
    );

    localStorage.setItem(
        STORAGE_THEME,
        next
    );
}

function applyTheme(
    theme
) {
    document.body.classList.toggle(
        "dark",
        theme === "dark"
    );

    if (themeIcon) {
        themeIcon.textContent =
            theme === "dark"
                ? "☀️"
                : "🌙";
    }
}

// =====================================================
// CONNECTION UI
// =====================================================

function updateConnectionUI(
    connected,
    text
) {
    if (connectionText) {
        connectionText.textContent =
            text;
    }

    if (connectionStatus) {
        connectionStatus.textContent =
            text;
    }

    if (connectionPill) {
        connectionPill.classList.toggle(
            "online",
            connected
        );

        connectionPill.classList.toggle(
            "offline",
            !connected
        );
    }
}

// =====================================================
// LOCATION UI
// =====================================================

function updateLocationUI(
    text
) {
    if (locationStatus) {
        locationStatus.textContent =
            text;
    }
}

// =====================================================
// ERRORS
// =====================================================

function clearErrors() {
    clearSetupError();
    clearRoomError();
}

function clearSetupError() {
    if (setupError) {
        setupError.textContent =
            "";
        setupError.style.display =
            "none";
    }
}

function clearRoomError() {
    if (roomError) {
        roomError.textContent =
            "";
        roomError.style.display =
            "none";
    }
}

function showSetupError(
    message
) {
    if (!setupError) {
        return;
    }

    setupError.textContent =
        message;

    setupError.style.display =
        "";
}

function showRoomError(
    message
) {
    if (!roomError) {
        return;
    }

    roomError.textContent =
        message;

    roomError.style.display =
        "";
}

// =====================================================
// SERVER ERROR
// =====================================================

function handleServerError(
    message
) {
    setButtonLoading(
        createRoomBtn,
        false
    );

    setButtonLoading(
        joinRoomBtn,
        false
    );

    if (
        message ===
        "Bunday guruh topilmadi."
    ) {
        localStorage.removeItem(
            STORAGE_ROOM_CODE
        );

        if (currentRoom) {
            removeSavedGroup(
                currentRoom
            );
        }

        currentRoom = "";

        stopLocationSharing();
        clearMarkers();

        showSetup();

        showSetupError(
            "Saqlangan guruh topilmadi. Yangi guruh yarating yoki yangi guruh kodini kiriting."
        );

        return;
    }

    if (roomCard &&
        roomCard.style.display !==
            "none"
    ) {
        showRoomError(
            message ||
                "Xatolik yuz berdi."
        );
    } else {
        showSetupError(
            message ||
                "Xatolik yuz berdi."
        );
    }
}

// =====================================================
// CLEAR MARKERS
// =====================================================

function clearMarkers() {
    if (map) {
        for (
            const marker of markers.values()
        ) {
            try {
                map.removeLayer(
                    marker
                );
            } catch (error) {
                // ignore
            }
        }

        for (
            const circle of accuracyCircles.values()
        ) {
            try {
                map.removeLayer(
                    circle
                );
            } catch (error) {
                // ignore
            }
        }
    }

    markers.clear();
    accuracyCircles.clear();

    currentPosition = null;
    lastUsers = [];

    hasCenteredOnOwnLocation =
        false;

    if (memberCount) {
        memberCount.textContent =
            "0";
    }

    if (membersList) {
        membersList.innerHTML =
            "";
    }
}

// =====================================================
// RECONNECT
// =====================================================

function scheduleReconnect() {
    if (reconnectTimer) {
        return;
    }

    reconnectTimer =
        setTimeout(
            function() {
                reconnectTimer =
                    null;

                connectWebSocket();

                reconnectDelay =
                    Math.min(
                        reconnectDelay *
                            1.5,
                        15000
                    );
            },
            reconnectDelay
        );
}

// =====================================================
// BUTTON LOADING
// =====================================================

function setButtonLoading(
    button,
    loading
) {
    if (!button) {
        return;
    }

    button.disabled =
        loading;

    if (loading) {
        button.dataset.oldText =
            button.textContent;

        button.textContent =
            "Kutilmoqda...";
    } else {
        if (
            button.dataset.oldText
        ) {
            button.textContent =
                button.dataset.oldText;
        }
    }
}
