"use strict";

/* =========================================================
   LIVE GPS — CLIENT
   ========================================================= */

/* =========================================================
   STORAGE
   ========================================================= */

const STORAGE = {
    USER_NAME: "live-gps-user-name",
    ROOM_CODE: "live-gps-room-code",
    USER_ID: "live-gps-user-id",
    THEME: "live-gps-theme",
    SAVED_GROUPS: "live-gps-saved-groups"
};


/* =========================================================
   DOM
   ========================================================= */

let setupCard;
let roomCard;

let userNameInput;
let roomCodeInput;

let createRoomBtn;
let joinRoomBtn;

let currentRoomCode;
let copyRoomBtn;

let connectionStatus;
let locationStatus;

let membersList;
let membersCount;

let switchRoomInput;
let switchRoomBtn;

let themeBtn;

let errorBox;
let errorText;

let centerMapBtn;
let myLocationBtn;


/* =========================================================
   STATE
   ========================================================= */

let socket = null;

let myUserId = null;
let currentName = "";
let currentRoom = "";

let reconnectTimer = null;
let reconnectDelay = 1500;

let gpsWatchId = null;

let map = null;
let mapReady = false;

let currentPosition = null;

let markerMap = new Map();

let lastUsers = [];

let isRestoring = false;
let locationStarted = false;
let hasCenteredOnOwnLocation = false;

let pendingJoin = null;
let pendingCreate = false;

let joinTimeoutTimer = null;


/* =========================================================
   DOM CACHE
   ========================================================= */

function cacheDom() {
    setupCard = document.getElementById("setupCard");
    roomCard = document.getElementById("roomCard");

    userNameInput = document.getElementById("userName");
    roomCodeInput = document.getElementById("roomCode");

    createRoomBtn = document.getElementById("createRoomBtn");
    joinRoomBtn = document.getElementById("joinRoomBtn");

    currentRoomCode = document.getElementById("currentRoomCode");
    copyRoomBtn = document.getElementById("copyRoomBtn");

    connectionStatus = document.getElementById("connectionStatus");
    locationStatus = document.getElementById("locationStatus");

    membersList = document.getElementById("membersList");
    membersCount = document.getElementById("membersCount");

    switchRoomInput = document.getElementById("switchRoomInput");
    switchRoomBtn = document.getElementById("switchRoomBtn");

    themeBtn = document.getElementById("themeBtn");

    errorBox = document.getElementById("errorBox");
    errorText = document.getElementById("errorText");

    centerMapBtn = document.getElementById("centerMapBtn");
    myLocationBtn = document.getElementById("myLocationBtn");
}


/* =========================================================
   START
   ========================================================= */

document.addEventListener("DOMContentLoaded", () => {
    cacheDom();

    injectPremiumSavedGroupsStyles();

    loadTheme();
    loadSavedUser();

    renderSavedGroups();

    bindEvents();

    connectWebSocket();
});


/* =========================================================
   EVENTS
   ========================================================= */

function bindEvents() {

    if (createRoomBtn) {
        createRoomBtn.addEventListener("click", createRoom);
    }

    if (joinRoomBtn) {
        joinRoomBtn.addEventListener("click", joinRoom);
    }

    if (copyRoomBtn) {
        copyRoomBtn.addEventListener("click", copyRoomCode);
    }

    if (switchRoomBtn) {
        switchRoomBtn.addEventListener("click", switchToAnotherRoom);
    }

    if (themeBtn) {
        themeBtn.addEventListener("click", toggleTheme);
    }

    if (centerMapBtn) {
        centerMapBtn.addEventListener("click", centerMap);
    }

    if (myLocationBtn) {
        myLocationBtn.addEventListener("click", centerOnMyLocation);
    }

    if (roomCodeInput) {
        roomCodeInput.addEventListener("input", () => {
            roomCodeInput.value = roomCodeInput.value
                .toUpperCase()
                .replace(/[^A-Z0-9]/g, "")
                .slice(0, 6);
        });

        roomCodeInput.addEventListener("keydown", event => {
            if (event.key === "Enter") {
                joinRoom();
            }
        });
    }

    if (userNameInput) {
        userNameInput.addEventListener("keydown", event => {
            if (event.key === "Enter") {
                joinRoom();
            }
        });
    }

    if (switchRoomInput) {
        switchRoomInput.addEventListener("input", () => {
            switchRoomInput.value = switchRoomInput.value
                .toUpperCase()
                .replace(/[^A-Z0-9]/g, "")
                .slice(0, 6);
        });

        switchRoomInput.addEventListener("keydown", event => {
            if (event.key === "Enter") {
                switchToAnotherRoom();
            }
        });
    }
}


/* =========================================================
   LOCAL USER
   ========================================================= */

function loadSavedUser() {

    const savedName = localStorage.getItem(STORAGE.USER_NAME);

    if (savedName && userNameInput) {
        userNameInput.value = savedName;
    }
}


function saveUserName(name) {

    if (!name) return;

    localStorage.setItem(
        STORAGE.USER_NAME,
        name.trim()
    );
}


/* =========================================================
   SAVED GROUPS
   ========================================================= */

function getSavedGroups() {

    try {

        const raw = localStorage.getItem(
            STORAGE.SAVED_GROUPS
        );

        if (!raw) return [];

        const groups = JSON.parse(raw);

        if (!Array.isArray(groups)) {
            return [];
        }

        return groups.filter(group =>
            group &&
            typeof group.code === "string" &&
            /^[A-Z0-9]{6}$/.test(group.code)
        );

    } catch (error) {

        console.warn(
            "Saqlangan guruhlarni o‘qishda xato:",
            error
        );

        return [];
    }
}


function saveSavedGroups(groups) {

    try {

        localStorage.setItem(
            STORAGE.SAVED_GROUPS,
            JSON.stringify(groups)
        );

    } catch (error) {

        console.warn(
            "Saqlangan guruhlarni saqlashda xato:",
            error
        );
    }
}


function saveCurrentGroup() {

    if (!currentRoom) return;

    const groups = getSavedGroups();

    const now = Date.now();

    const existingIndex = groups.findIndex(
        group => group.code === currentRoom
    );

    const oldGroup =
        existingIndex >= 0
            ? groups[existingIndex]
            : null;

    const group = {
        code: currentRoom,
        name:
            currentName ||
            oldGroup?.name ||
            "Mening guruhim",

        savedAt:
            oldGroup?.savedAt ||
            now,

        lastUsedAt: now
    };

    if (existingIndex >= 0) {
        groups.splice(existingIndex, 1);
    }

    groups.unshift(group);

    saveSavedGroups(
        groups.slice(0, 10)
    );

    renderSavedGroups();
}


function removeSavedGroup(code) {

    const groups = getSavedGroups();

    const filtered = groups.filter(
        group => group.code !== code
    );

    saveSavedGroups(filtered);

    renderSavedGroups();
}


function joinSavedGroup(code) {

    const normalizedCode = String(code || "")
        .trim()
        .toUpperCase();

    if (!/^[A-Z0-9]{6}$/.test(normalizedCode)) {
        return;
    }

    const groups = getSavedGroups();

    const savedGroup = groups.find(
        group => group.code === normalizedCode
    );

    if (savedGroup && userNameInput) {

        if (!userNameInput.value.trim()) {
            userNameInput.value =
                savedGroup.name || "";
        }
    }

    if (roomCodeInput) {
        roomCodeInput.value = normalizedCode;
    }

    joinRoom();
}


function updateSavedGroupLastUsed(code) {

    const groups = getSavedGroups();

    const index = groups.findIndex(
        group => group.code === code
    );

    if (index === -1) return;

    groups[index].lastUsedAt = Date.now();

    saveSavedGroups(groups);
}


function formatSavedDate(timestamp) {

    if (!timestamp) {
        return "Yaqinda";
    }

    const date = new Date(timestamp);

    if (Number.isNaN(date.getTime())) {
        return "Yaqinda";
    }

    const now = new Date();

    const sameDay =
        date.getFullYear() === now.getFullYear() &&
        date.getMonth() === now.getMonth() &&
        date.getDate() === now.getDate();

    if (sameDay) {
        return "Bugun";
    }

    const yesterday = new Date(now);

    yesterday.setDate(
        yesterday.getDate() - 1
    );

    const isYesterday =
        date.getFullYear() === yesterday.getFullYear() &&
        date.getMonth() === yesterday.getMonth() &&
        date.getDate() === yesterday.getDate();

    if (isYesterday) {
        return "Kecha";
    }

    return date.toLocaleDateString(
        "uz-UZ",
        {
            day: "2-digit",
            month: "short"
        }
    );
}


function renderSavedGroups() {

    const oldSection =
        document.getElementById(
            "savedGroupsSection"
        );

    if (oldSection) {
        oldSection.remove();
    }

    if (!setupCard) return;

    const groups = getSavedGroups();

    const section =
        document.createElement("section");

    section.id = "savedGroupsSection";
    section.className =
        "saved-groups-section premium-saved-groups";

    section.innerHTML = `
        <div class="saved-groups-head">

            <div class="saved-groups-title-wrap">

                <div class="saved-groups-icon">
                    <span>⌖</span>
                </div>

                <div>
                    <div class="saved-groups-title">
                        Saqlangan guruhlar
                    </div>

                    <div class="saved-groups-subtitle">
                        Oldingi guruhlaringizga tez qayting
                    </div>
                </div>

            </div>

            <div class="saved-groups-count">
                ${groups.length}
            </div>

        </div>

        ${
            groups.length
                ? `
                    <div class="saved-groups-list">
                        ${groups.map(renderSavedGroupItem).join("")}
                    </div>
                  `
                : `
                    <div class="saved-groups-empty">

                        <div class="saved-empty-icon">
                            ◉
                        </div>

                        <div class="saved-empty-title">
                            Hali guruh saqlanmagan
                        </div>

                        <div class="saved-empty-text">
                            Guruh yaratganingiz yoki unga
                            qo‘shilganingizdan so‘ng u shu yerda
                            avtomatik saqlanadi.
                        </div>

                    </div>
                  `
        }
    `;

    setupCard.appendChild(section);

    section.addEventListener(
        "click",
        event => {

            const joinButton =
                event.target.closest(
                    "[data-action='join-saved']"
                );

            const deleteButton =
                event.target.closest(
                    "[data-action='delete-saved']"
                );

            const copyButton =
                event.target.closest(
                    "[data-action='copy-saved']"
                );

            if (joinButton) {

                const code =
                    joinButton.dataset.code;

                joinSavedGroup(code);

                return;
            }

            if (deleteButton) {

                const code =
                    deleteButton.dataset.code;

                removeSavedGroup(code);

                return;
            }

            if (copyButton) {

                const code =
                    copyButton.dataset.code;

                copyText(code);

                showTemporaryMessage(
                    "Guruh kodi nusxalandi"
                );
            }
        }
    );
}


function renderSavedGroupItem(group) {

    const code =
        escapeHtml(group.code);

    const name =
        escapeHtml(
            group.name ||
            "Mening guruhim"
        );

    const date =
        formatSavedDate(
            group.lastUsedAt ||
            group.savedAt
        );

    return `
        <div class="saved-group-item premium-saved-item">

            <button
                type="button"
                class="saved-group-main"
                data-action="join-saved"
                data-code="${code}"
            >

                <div class="saved-group-pin">
                    <span>⌖</span>
                </div>

                <div class="saved-group-info">

                    <div class="saved-group-name">
                        ${name}
                    </div>

                    <div class="saved-group-meta">

                        <span class="saved-group-code">
                            ${code}
                        </span>

                        <span class="saved-group-dot">
                            •
                        </span>

                        <span>
                            ${date}
                        </span>

                    </div>

                </div>

                <div class="saved-group-arrow">
                    →
                </div>

            </button>

            <div class="saved-group-actions">

                <button
                    type="button"
                    class="saved-action-btn"
                    title="Kodni nusxalash"
                    data-action="copy-saved"
                    data-code="${code}"
                >
                    ⧉
                </button>

                <button
                    type="button"
                    class="saved-action-btn danger"
                    title="O‘chirish"
                    data-action="delete-saved"
                    data-code="${code}"
                >
                    ×
                </button>

            </div>

        </div>
    `;
}


/* =========================================================
   PREMIUM SAVED GROUP CSS
   ========================================================= */

function injectPremiumSavedGroupsStyles() {

    if (
        document.getElementById(
            "savedGroupsPremiumStyles"
        )
    ) {
        return;
    }

    const style =
        document.createElement("style");

    style.id =
        "savedGroupsPremiumStyles";

    style.textContent = `
        .premium-saved-groups{
            width:100%;
            margin-top:20px;
            padding:18px;
            border-radius:24px;
            border:1px solid rgba(25,214,107,.14);
            background:
                linear-gradient(
                    145deg,
                    rgba(255,255,255,.96),
                    rgba(247,250,248,.94)
                );
            box-shadow:
                0 14px 40px rgba(16,40,28,.08);
            overflow:hidden;
        }

        .saved-groups-head{
            display:flex;
            align-items:center;
            justify-content:space-between;
            gap:14px;
            margin-bottom:16px;
        }

        .saved-groups-title-wrap{
            display:flex;
            align-items:center;
            gap:12px;
            min-width:0;
        }

        .saved-groups-icon{
            width:44px;
            height:44px;
            flex:none;
            display:flex;
            align-items:center;
            justify-content:center;
            border-radius:14px;
            background:
                linear-gradient(
                    135deg,
                    #19d66b,
                    #0bbf5a
                );
            color:#fff;
            font-size:24px;
            box-shadow:
                0 8px 22px rgba(25,214,107,.25);
        }

        .saved-groups-title{
            font-size:16px;
            font-weight:800;
            color:#142019;
            letter-spacing:-.2px;
        }

        .saved-groups-subtitle{
            margin-top:3px;
            font-size:12px;
            line-height:1.4;
            color:#77827d;
        }

        .saved-groups-count{
            min-width:32px;
            height:32px;
            padding:0 9px;
            display:flex;
            align-items:center;
            justify-content:center;
            border-radius:11px;
            background:rgba(25,214,107,.11);
            color:#0ca451;
            font-size:13px;
            font-weight:800;
        }

        .saved-groups-list{
            display:flex;
            flex-direction:column;
            gap:9px;
        }

        .premium-saved-item{
            display:flex;
            align-items:center;
            gap:6px;
            min-width:0;
            border:1px solid rgba(20,40,30,.07);
            border-radius:18px;
            background:rgba(255,255,255,.88);
            transition:
                transform .2s ease,
                box-shadow .2s ease,
                border-color .2s ease;
        }

        .premium-saved-item:hover{
            transform:translateY(-2px);
            border-color:rgba(25,214,107,.24);
            box-shadow:
                0 10px 25px rgba(20,50,34,.08);
        }

        .saved-group-main{
            flex:1;
            min-width:0;
            display:flex;
            align-items:center;
            gap:12px;
            padding:11px 8px 11px 11px;
            border:0;
            background:transparent;
            text-align:left;
            color:inherit;
            cursor:pointer;
        }

        .saved-group-pin{
            width:40px;
            height:40px;
            flex:none;
            display:flex;
            align-items:center;
            justify-content:center;
            border-radius:13px;
            background:#effbf4;
            color:#10bd5d;
            font-size:20px;
        }

        .saved-group-info{
            min-width:0;
            flex:1;
        }

        .saved-group-name{
            overflow:hidden;
            text-overflow:ellipsis;
            white-space:nowrap;
            font-size:14px;
            font-weight:750;
            color:#17231c;
        }

        .saved-group-meta{
            display:flex;
            align-items:center;
            gap:6px;
            margin-top:4px;
            font-size:11px;
            color:#87918c;
        }

        .saved-group-code{
            font-weight:800;
            letter-spacing:1.2px;
            color:#10ad57;
        }

        .saved-group-dot{
            opacity:.5;
        }

        .saved-group-arrow{
            width:30px;
            flex:none;
            text-align:center;
            font-size:21px;
            color:#a2aaa6;
            transition:
                transform .2s ease,
                color .2s ease;
        }

        .saved-group-main:hover .saved-group-arrow{
            color:#10bd5d;
            transform:translateX(3px);
        }

        .saved-group-actions{
            display:flex;
            align-items:center;
            gap:4px;
            padding-right:8px;
        }

        .saved-action-btn{
            width:32px;
            height:32px;
            display:flex;
            align-items:center;
            justify-content:center;
            border:0;
            border-radius:10px;
            background:rgba(20,40,30,.055);
            color:#69746e;
            font-size:16px;
            cursor:pointer;
            transition:
                background .2s ease,
                color .2s ease,
                transform .2s ease;
        }

        .saved-action-btn:hover{
            background:rgba(25,214,107,.12);
            color:#0ca451;
            transform:scale(1.05);
        }

        .saved-action-btn.danger:hover{
            background:rgba(255,75,75,.10);
            color:#e64d4d;
        }

        .saved-groups-empty{
            padding:24px 12px 14px;
            text-align:center;
        }

        .saved-empty-icon{
            width:52px;
            height:52px;
            margin:0 auto 10px;
            display:flex;
            align-items:center;
            justify-content:center;
            border-radius:17px;
            background:#effbf4;
            color:#19c965;
            font-size:23px;
        }

        .saved-empty-title{
            font-size:14px;
            font-weight:800;
            color:#26322b;
        }

        .saved-empty-text{
            max-width:360px;
            margin:6px auto 0;
            font-size:12px;
            line-height:1.55;
            color:#89928e;
        }

        body.dark .premium-saved-groups,
        .dark .premium-saved-groups{
            border-color:rgba(25,214,107,.15);
            background:
                linear-gradient(
                    145deg,
                    rgba(20,29,24,.98),
                    rgba(14,22,18,.98)
                );
            box-shadow:
                0 16px 45px rgba(0,0,0,.22);
        }

        body.dark .saved-groups-title,
        .dark .saved-groups-title{
            color:#f2f7f4;
        }

        body.dark .saved-groups-subtitle,
        .dark .saved-groups-subtitle{
            color:#89958f;
        }

        body.dark .premium-saved-item,
        .dark .premium-saved-item{
            background:rgba(255,255,255,.035);
            border-color:rgba(255,255,255,.06);
        }

        body.dark .saved-group-name,
        .dark .saved-group-name{
            color:#edf4ef;
        }

        body.dark .saved-group-pin,
        .dark .saved-group-pin{
            background:rgba(25,214,107,.10);
        }

        body.dark .saved-action-btn,
        .dark .saved-action-btn{
            background:rgba(255,255,255,.06);
            color:#9aa59f;
        }

        body.dark .saved-empty-title,
        .dark .saved-empty-title{
            color:#edf4ef;
        }

        body.dark .saved-empty-icon,
        .dark .saved-empty-icon{
            background:rgba(25,214,107,.10);
        }

        @media(max-width:600px){

            .premium-saved-groups{
                padding:14px;
                border-radius:20px;
            }

            .saved-groups-icon{
                width:40px;
                height:40px;
                border-radius:12px;
            }

            .saved-groups-title{
                font-size:14px;
            }

            .saved-groups-subtitle{
                font-size:11px;
            }

            .saved-group-main{
                gap:9px;
                padding-left:8px;
            }

            .saved-group-pin{
                width:36px;
                height:36px;
                border-radius:11px;
            }

            .saved-group-arrow{
                display:none;
            }

            .saved-action-btn{
                width:30px;
                height:30px;
            }
        }
    `;

    document.head.appendChild(style);
}


/* =========================================================
   ESCAPE HTML
   ========================================================= */

function escapeHtml(value) {

    return String(value ?? "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
}


/* =========================================================
   WEBSOCKET URL
   ========================================================= */

function getWebSocketUrl() {

    const protocol =
        location.protocol === "https:"
            ? "wss:"
            : "ws:";

    return `${protocol}//${location.host}`;
}


/* =========================================================
   WEBSOCKET CONNECT
   ========================================================= */

function connectWebSocket() {

    if (
        socket &&
        (
            socket.readyState === WebSocket.OPEN ||
            socket.readyState === WebSocket.CONNECTING
        )
    ) {
        return;
    }

    clearTimeout(reconnectTimer);

    updateConnectionUI(
        "Serverga ulanilmoqda...",
        "connecting"
    );

    try {

        socket = new WebSocket(
            getWebSocketUrl()
        );

    } catch (error) {

        console.error(error);

        scheduleReconnect();

        return;
    }


    socket.addEventListener(
        "open",
        () => {

            reconnectDelay = 1500;

            updateConnectionUI(
                "Server bilan bog‘langan",
                "online"
            );

            clearError();

            /*
             * Agar foydalanuvchi ulanish paytida
             * "Qo‘shilish" tugmasini bosgan bo‘lsa,
             * shu yerda davom ettiramiz.
             */

            if (pendingCreate) {

                pendingCreate = false;

                setTimeout(() => {
                    actuallyCreateRoom();
                }, 100);

                return;
            }

            if (pendingJoin) {

                const request =
                    pendingJoin;

                pendingJoin = null;

                setTimeout(() => {
                    sendJoinRequest(
                        request.name,
                        request.code
                    );
                }, 100);

                return;
            }

            restoreSession();
        }
    );


    socket.addEventListener(
        "message",
        event => {

            try {

                const data =
                    JSON.parse(event.data);

                handleSocketMessage(data);

            } catch (error) {

                console.error(
                    "WebSocket message error:",
                    error
                );
            }
        }
    );


    socket.addEventListener(
        "close",
        () => {

            updateConnectionUI(
                "Server bilan aloqa uzildi",
                "offline"
            );

            scheduleReconnect();
        }
    );


    socket.addEventListener(
        "error",
        error => {

            console.warn(
                "WebSocket error:",
                error
            );

            updateConnectionUI(
                "Ulanishda muammo",
                "offline"
            );
        }
    );
}


/* =========================================================
   RECONNECT
   ========================================================= */

function scheduleReconnect() {

    clearTimeout(reconnectTimer);

    reconnectTimer = setTimeout(
        () => {

            connectWebSocket();

        },
        reconnectDelay
    );

    reconnectDelay =
        Math.min(
            reconnectDelay * 1.5,
            10000
        );
}


/* =========================================================
   SOCKET MESSAGE
   ========================================================= */

function handleSocketMessage(data) {

    if (!data || !data.type) {
        return;
    }


    /* -------------------------
       CONNECTED
       ------------------------- */

    if (data.type === "connected") {

        if (data.userId) {

            myUserId =
                String(data.userId);

            localStorage.setItem(
                STORAGE.USER_ID,
                myUserId
            );
        }

        return;
    }


    /* -------------------------
       ROOM CREATED
       ------------------------- */

    if (data.type === "room-created") {

        clearJoinTimeout();

        pendingCreate = false;
        pendingJoin = null;

        resetButtonLoading();

        currentRoom =
            String(data.roomCode || "")
                .toUpperCase();

        if (data.userId) {

            myUserId =
                String(data.userId);

            localStorage.setItem(
                STORAGE.USER_ID,
                myUserId
            );
        }

        localStorage.setItem(
            STORAGE.ROOM_CODE,
            currentRoom
        );

        saveCurrentGroup();

        showRoom();

        return;
    }


    /* -------------------------
       JOINED ROOM
       ------------------------- */

    if (data.type === "joined-room") {

        clearJoinTimeout();

        pendingCreate = false;
        pendingJoin = null;

        resetButtonLoading();

        isRestoring = false;

        currentRoom =
            String(data.roomCode || "")
                .toUpperCase();

        if (data.userId) {

            myUserId =
                String(data.userId);

            localStorage.setItem(
                STORAGE.USER_ID,
                myUserId
            );
        }

        localStorage.setItem(
            STORAGE.ROOM_CODE,
            currentRoom
        );

        saveCurrentGroup();

        updateSavedGroupLastUsed(
            currentRoom
        );

        renderSavedGroups();

        showRoom();

        /*
         * Map va GPS ishga tushgandan keyin
         * joriy joylashuvni yuboramiz.
         */

        setTimeout(() => {

            sendCurrentPosition();

        }, 300);

        return;
    }


    /* -------------------------
       USERS
       ------------------------- */

    if (data.type === "users") {

        lastUsers =
            Array.isArray(data.users)
                ? data.users
                : [];

        renderUsers(
            lastUsers
        );

        return;
    }


    /* -------------------------
       LEFT ROOM
       ------------------------- */

    if (data.type === "left-room") {

        clearJoinTimeout();

        resetButtonLoading();

        currentRoom = "";

        localStorage.removeItem(
            STORAGE.ROOM_CODE
        );

        stopLocationSharing();
        clearMarkers();

        showSetup();

        return;
    }


    /* -------------------------
       ERROR
       ------------------------- */

    if (data.type === "error") {

        handleServerError(
            data.message ||
            "Noma’lum xatolik."
        );

        return;
    }
}


/* =========================================================
   RESTORE SESSION
   ========================================================= */

function restoreSession() {

    if (!isSocketReady()) {
        return;
    }

    if (pendingJoin || pendingCreate) {
        return;
    }

    if (isRestoring) {
        return;
    }

    const savedRoom =
        localStorage.getItem(
            STORAGE.ROOM_CODE
        );

    const savedName =
        localStorage.getItem(
            STORAGE.USER_NAME
        );

    const savedUserId =
        localStorage.getItem(
            STORAGE.USER_ID
        );

    if (
        !savedRoom ||
        !savedName
    ) {
        return;
    }

    const normalizedRoom =
        savedRoom
            .trim()
            .toUpperCase();

    if (
        !/^[A-Z0-9]{6}$/.test(
            normalizedRoom
        )
    ) {
        localStorage.removeItem(
            STORAGE.ROOM_CODE
        );

        return;
    }

    isRestoring = true;

    currentName =
        savedName.trim();

    if (userNameInput) {
        userNameInput.value =
            currentName;
    }

    send({
        type: "join-room",
        roomCode: normalizedRoom,
        name: currentName,
        userId: savedUserId || undefined
    });

    setTimeout(() => {
        isRestoring = false;
    }, 6000);
}


/* =========================================================
   CREATE ROOM
   ========================================================= */

function createRoom() {

    clearError();

    const name =
        userNameInput
            ? userNameInput.value.trim()
            : "";

    if (!name) {

        showError(
            "Avval ismingizni kiriting."
        );

        if (userNameInput) {
            userNameInput.focus();
        }

        return;
    }

    saveUserName(name);

    currentName = name;

    /*
     * WebSocket hali ulanayotgan bo‘lsa,
     * kutib turamiz.
     */

    if (
        !socket ||
        socket.readyState === WebSocket.CONNECTING
    ) {

        pendingCreate = true;

        setButtonLoading(
            createRoomBtn,
            "Ulanmoqda..."
        );

        connectWebSocket();

        return;
    }

    if (!isSocketReady()) {

        showError(
            "Serverga ulanish qayta tiklanmoqda. Biroz kuting."
        );

        connectWebSocket();

        return;
    }

    actuallyCreateRoom();
}


function actuallyCreateRoom() {

    if (!isSocketReady()) {

        pendingCreate = true;

        connectWebSocket();

        return;
    }

    const name =
        userNameInput
            ? userNameInput.value.trim()
            : currentName;

    if (!name) {
        return;
    }

    currentName = name;

    saveUserName(name);

    setButtonLoading(
        createRoomBtn,
        "Yaratilmoqda..."
    );

    send({
        type: "create-room",
        name,
        userId: myUserId || undefined
    });

    startJoinTimeout(
        "Guruh yaratish javobi kelmadi. Qayta urinib ko‘ring."
    );
}


/* =========================================================
   JOIN ROOM
   ========================================================= */

function joinRoom() {

    clearError();

    const name =
        userNameInput
            ? userNameInput.value.trim()
            : "";

    const code =
        roomCodeInput
            ? roomCodeInput.value
                .trim()
                .toUpperCase()
            : "";

    if (!name) {

        showError(
            "Avval ismingizni kiriting."
        );

        if (userNameInput) {
            userNameInput.focus();
        }

        return;
    }

    if (!/^[A-Z0-9]{6}$/.test(code)) {

        showError(
            "Guruh kodi 6 ta belgidan iborat bo‘lishi kerak."
        );

        if (roomCodeInput) {
            roomCodeInput.focus();
        }

        return;
    }

    currentName = name;

    saveUserName(name);

    /*
     * WebSocket CONNECTING bo‘lsa,
     * qo‘shilish so‘rovini navbatga qo‘yamiz.
     */

    if (
        !socket ||
        socket.readyState === WebSocket.CONNECTING
    ) {

        pendingJoin = {
            name,
            code
        };

        setButtonLoading(
            joinRoomBtn,
            "Ulanmoqda..."
        );

        connectWebSocket();

        return;
    }

    if (!isSocketReady()) {

        pendingJoin = {
            name,
            code
        };

        setButtonLoading(
            joinRoomBtn,
            "Qayta ulanmoqda..."
        );

        connectWebSocket();

        return;
    }

    sendJoinRequest(
        name,
        code
    );
}


/* =========================================================
   SEND JOIN REQUEST
   ========================================================= */

function sendJoinRequest(
    name,
    code
) {

    if (!isSocketReady()) {

        pendingJoin = {
            name,
            code
        };

        connectWebSocket();

        return;
    }

    currentName = name;

    saveUserName(name);

    if (roomCodeInput) {
        roomCodeInput.value = code;
    }

    setButtonLoading(
        joinRoomBtn,
        "Qo‘shilmoqda..."
    );

    send({
        type: "join-room",
        roomCode: code,
        name,
        userId: myUserId || undefined
    });

    startJoinTimeout(
        "Guruhga qo‘shilish javobi kelmadi. Qayta urinib ko‘ring."
    );
}


/* =========================================================
   JOIN TIMEOUT
   ========================================================= */

function startJoinTimeout(message) {

    clearJoinTimeout();

    joinTimeoutTimer = setTimeout(
        () => {

            pendingJoin = null;
            pendingCreate = false;

            resetButtonLoading();

            showError(message);

        },
        12000
    );
}


function clearJoinTimeout() {

    if (joinTimeoutTimer) {

        clearTimeout(
            joinTimeoutTimer
        );

        joinTimeoutTimer = null;
    }
}


/* =========================================================
   SWITCH ROOM
   ========================================================= */

function switchToAnotherRoom() {

    clearError();

    const code =
        switchRoomInput
            ? switchRoomInput.value
                .trim()
                .toUpperCase()
            : "";

    if (!/^[A-Z0-9]{6}$/.test(code)) {

        showError(
            "Yangi guruh kodi 6 ta belgidan iborat bo‘lishi kerak."
        );

        return;
    }

    if (!currentName) {

        currentName =
            localStorage.getItem(
                STORAGE.USER_NAME
            ) || "";

    }

    if (!currentName) {

        showError(
            "Ism topilmadi."
        );

        return;
    }

    if (!isSocketReady()) {

        pendingJoin = {
            name: currentName,
            code
        };

        connectWebSocket();

        return;
    }

    clearMarkers();

    send({
        type: "join-room",
        roomCode: code,
        name: currentName,
        userId: myUserId || undefined
    });

    startJoinTimeout(
        "Yangi guruhga ulanish javobi kelmadi."
    );
}


/* =========================================================
   SOCKET SEND
   ========================================================= */

function send(data) {

    if (!isSocketReady()) {
        return false;
    }

    try {

        socket.send(
            JSON.stringify(data)
        );

        return true;

    } catch (error) {

        console.error(
            "Socket send error:",
            error
        );

        return false;
    }
}


function isSocketReady() {

    return (
        socket &&
        socket.readyState === WebSocket.OPEN
    );
}


/* =========================================================
   SHOW ROOM
   ========================================================= */

function showRoom() {

    if (setupCard) {

        setupCard.classList.add(
            "hidden"
        );

        setupCard.style.display =
            "none";
    }

    if (roomCard) {

        /*
         * Muhim:
         * .hidden class qolib ketmasligi uchun
         * uni olib tashlaymiz.
         */

        roomCard.classList.remove(
            "hidden"
        );

        roomCard.style.display =
            "block";
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

        setTimeout(() => {

            map.invalidateSize();

        }, 150);
    }

    startLocationSharing();

    updateLocationUI(
        "Joylashuv olinmoqda..."
    );
}


/* =========================================================
   SHOW SETUP
   ========================================================= */

function showSetup() {

    if (setupCard) {

        setupCard.classList.remove(
            "hidden"
        );

        setupCard.style.display =
            "";
    }

    if (roomCard) {

        roomCard.classList.add(
            "hidden"
        );

        roomCard.style.display =
            "none";
    }

    stopLocationSharing();

    clearMarkers();

    renderSavedGroups();
}


/* =========================================================
   LEAFLET MAP
   ========================================================= */

function initMap() {

    if (mapReady && map) {
        return;
    }

    const mapElement =
        document.getElementById("map");

    if (!mapElement) {
        return;
    }

    if (
        typeof L === "undefined"
    ) {

        console.warn(
            "Leaflet topilmadi."
        );

        return;
    }

    map =
        L.map(
            mapElement,
            {
                zoomControl: true
            }
        ).setView(
            [41.3111, 69.2797],
            12
        );

    L.tileLayer(
        "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png",
        {
            maxZoom: 19,
            attribution:
                "&copy; OpenStreetMap"
        }
    ).addTo(map);

    mapReady = true;

    setTimeout(() => {

        map.invalidateSize();

    }, 200);
}


/* =========================================================
   GPS
   ========================================================= */

function startLocationSharing() {

    if (
        locationStarted ||
        !navigator.geolocation
    ) {
        return;
    }

    locationStarted = true;

    updateLocationUI(
        "Joylashuv olinmoqda..."
    );

    gpsWatchId =
        navigator.geolocation.watchPosition(
            position => {

                const {
                    latitude,
                    longitude,
                    accuracy
                } = position.coords;

                currentPosition = {
                    lat: latitude,
                    lng: longitude,
                    accuracy:
                        Number(accuracy) || 0
                };

                updateLocationUI(
                    "Joylashuv faol"
                );

                sendCurrentPosition();

                /*
                 * Birinchi marta o‘z joyimizga markazlashamiz.
                 */

                if (
                    !hasCenteredOnOwnLocation
                ) {

                    hasCenteredOnOwnLocation =
                        true;

                    centerOnMyLocation();
                }
            },

            error => {

                console.warn(
                    "GPS error:",
                    error
                );

                if (
                    error.code ===
                    error.PERMISSION_DENIED
                ) {

                    updateLocationUI(
                        "Joylashuvga ruxsat berilmagan"
                    );

                } else if (
                    error.code ===
                    error.POSITION_UNAVAILABLE
                ) {

                    updateLocationUI(
                        "Joylashuv aniqlanmadi"
                    );

                } else {

                    updateLocationUI(
                        "Joylashuv olinmoqda..."
                    );
                }
            },

            {
                enableHighAccuracy: true,
                maximumAge: 5000,
                timeout: 15000
            }
        );
}


function stopLocationSharing() {

    if (
        gpsWatchId !== null &&
        navigator.geolocation
    ) {

        navigator.geolocation.clearWatch(
            gpsWatchId
        );
    }

    gpsWatchId = null;

    locationStarted = false;

    currentPosition = null;

    hasCenteredOnOwnLocation = false;
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

        lat:
            currentPosition.lat,

        lng:
            currentPosition.lng,

        accuracy:
            currentPosition.accuracy
    });
}


/* =========================================================
   RENDER USERS
   ========================================================= */

function renderUsers(users) {

    if (!Array.isArray(users)) {
        users = [];
    }

    /*
     * Online foydalanuvchilar birinchi,
     * offline foydalanuvchilar keyin.
     */

    users.sort(
        (a, b) => {

            if (
                Boolean(a.online) ===
                Boolean(b.online)
            ) {
                return 0;
            }

            return a.online ? -1 : 1;
        }
    );

    if (membersCount) {

        membersCount.textContent =
            String(users.length);
    }

    if (membersList) {

        membersList.innerHTML =
            users.map(renderMember).join("");
    }

    updateMarkers(users);
}


function renderMember(user) {

    const id =
        escapeHtml(
            user.id || ""
        );

    const name =
        escapeHtml(
            user.name ||
            "Noma’lum"
        );

    const online =
        Boolean(user.online);

    const isMe =
        user.id === myUserId;

    const statusText =
        online
            ? "Online"
            : "Offline";

    const offlineClass =
        online
            ? ""
            : "offline";

    const meText =
        isMe
            ? " Siz"
            : "";

    return `
        <div
            class="member-item ${offlineClass}"
            data-user-id="${id}"
        >

            <div class="member-avatar">
                ${escapeHtml(
                    (user.name || "?")
                        .charAt(0)
                        .toUpperCase()
                )}
            </div>

            <div class="member-info">

                <div class="member-name">
                    ${name}${meText}
                </div>

                <div class="member-status">
                    <span class="status-dot ${
                        online
                            ? "online"
                            : "offline"
                    }"></span>

                    ${statusText}

                    ${
                        !online && user.lastSeen
                            ? `
                                <span class="offline-time">
                                    • oxirgi joylashuv saqlangan
                                </span>
                              `
                            : ""
                    }
                </div>

            </div>

        </div>
    `;
}


/* =========================================================
   MAP MARKERS
   ========================================================= */

function updateMarkers(users) {

    if (!map || !mapReady) {
        return;
    }

    const activeIds = new Set();

    users.forEach(user => {

        if (
            typeof user.lat !== "number" ||
            typeof user.lng !== "number"
        ) {
            return;
        }

        if (
            !Number.isFinite(user.lat) ||
            !Number.isFinite(user.lng)
        ) {
            return;
        }

        activeIds.add(user.id);

        updateUserMarker(user);
    });


    /*
     * Serverdan butunlay o‘chgan foydalanuvchini
     * markerlardan ham olib tashlaymiz.
     *
     * Offline user serverda saqlanadi,
     * shuning uchun u users ro‘yxatida qoladi.
     */

    for (
        const [
            userId,
            marker
        ] of markerMap.entries()
    ) {

        if (!activeIds.has(userId)) {

            map.removeLayer(marker);

            markerMap.delete(userId);
        }
    }
}


function updateUserMarker(user) {

    if (!map) {
        return;
    }

    const position = [
        user.lat,
        user.lng
    ];

    let marker =
        markerMap.get(user.id);


    if (!marker) {

        marker =
            L.marker(
                position,
                {
                    opacity:
                        user.online
                            ? 1
                            : 0.55
                }
            ).addTo(map);

        markerMap.set(
            user.id,
            marker
        );

    } else {

        marker.setLatLng(
            position
        );

        marker.setOpacity(
            user.online
                ? 1
                : 0.55
        );
    }


    const name =
        escapeHtml(
            user.name ||
            "Noma’lum"
        );

    const status =
        user.online
            ? "🟢 Online"
            : "⚪ Offline";

    const isMe =
        user.id === myUserId;

    const meText =
        isMe
            ? " — Siz"
            : "";

    const accuracy =
        Number.isFinite(
            Number(user.accuracy)
        )
            ? Math.round(
                Number(user.accuracy)
            )
            : null;

    marker.bindPopup(`
        <div
            style="
                min-width:170px;
                font-family:Arial,sans-serif;
            "
        >

            <div
                style="
                    font-size:15px;
                    font-weight:800;
                    margin-bottom:5px;
                "
            >
                ${name}${meText}
            </div>

            <div
                style="
                    font-size:12px;
                    margin-bottom:5px;
                "
            >
                ${status}
            </div>

            ${
                accuracy !== null
                    ? `
                        <div
                            style="
                                font-size:11px;
                                color:#777;
                            "
                        >
                            Aniqlik: ±${accuracy} m
                        </div>
                      `
                    : ""
            }

        </div>
    `);
}


/* =========================================================
   MAP CENTER
   ========================================================= */

function centerMap() {

    if (!map || !mapReady) {
        return;
    }

    const usersWithLocation =
        lastUsers.filter(
            user =>
                typeof user.lat === "number" &&
                typeof user.lng === "number"
        );

    if (!usersWithLocation.length) {

        centerOnMyLocation();

        return;
    }

    const bounds =
        L.latLngBounds(
            usersWithLocation.map(
                user => [
                    user.lat,
                    user.lng
                ]
            )
        );

    map.fitBounds(
        bounds,
        {
            padding: [45, 45],
            maxZoom: 16
        }
    );
}


function centerOnMyLocation() {

    if (
        !map ||
        !mapReady ||
        !currentPosition
    ) {
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
}


/* =========================================================
   COPY
   ========================================================= */

async function copyRoomCode() {

    if (!currentRoom) {
        return;
    }

    const success =
        await copyText(
            currentRoom
        );

    if (success) {

        showTemporaryMessage(
            "Guruh kodi nusxalandi"
        );
    }
}


async function copyText(text) {

    try {

        if (
            navigator.clipboard &&
            window.isSecureContext
        ) {

            await navigator.clipboard.writeText(
                text
            );

            return true;
        }

        const textarea =
            document.createElement(
                "textarea"
            );

        textarea.value = text;

        textarea.style.position =
            "fixed";

        textarea.style.left =
            "-9999px";

        document.body.appendChild(
            textarea
        );

        textarea.select();

        const success =
            document.execCommand(
                "copy"
            );

        textarea.remove();

        return success;

    } catch (error) {

        console.warn(
            "Copy error:",
            error
        );

        return false;
    }
}


/* =========================================================
   THEME
   ========================================================= */

function loadTheme() {

    const savedTheme =
        localStorage.getItem(
            STORAGE.THEME
        );

    if (
        savedTheme === "dark"
    ) {

        document.body.classList.add(
            "dark"
        );

    } else {

        document.body.classList.remove(
            "dark"
        );
    }

    updateThemeButton();
}


function toggleTheme() {

    const isDark =
        document.body.classList.toggle(
            "dark"
        );

    localStorage.setItem(
        STORAGE.THEME,
        isDark
            ? "dark"
            : "light"
    );

    updateThemeButton();

    if (map) {

        setTimeout(() => {

            map.invalidateSize();

        }, 100);
    }
}


function updateThemeButton() {

    if (!themeBtn) {
        return;
    }

    const isDark =
        document.body.classList.contains(
            "dark"
        );

    /*
     * HTML ichida icon span bo‘lishi mumkin.
     * Butun tugmani buzmaslik uchun faqat
     * data-theme-icon elementini qidiramiz.
     */

    const icon =
        themeBtn.querySelector(
            "[data-theme-icon]"
        );

    if (icon) {

        icon.textContent =
            isDark
                ? "☀️"
                : "🌙";

        return;
    }

    themeBtn.setAttribute(
        "aria-label",
        isDark
            ? "Yorug‘ rejim"
            : "Tungi rejim"
    );
}


/* =========================================================
   UI STATUS
   ========================================================= */

function updateConnectionUI(
    text,
    status
) {

    if (!connectionStatus) {
        return;
    }

    connectionStatus.textContent =
        text;

    connectionStatus.dataset.status =
        status;

    connectionStatus.classList.remove(
        "online",
        "offline",
        "connecting"
    );

    connectionStatus.classList.add(
        status
    );
}


function updateLocationUI(text) {

    if (!locationStatus) {
        return;
    }

    locationStatus.textContent =
        text;
}


/* =========================================================
   ERRORS
   ========================================================= */

function showError(message) {

    if (errorBox) {

        errorBox.classList.remove(
            "hidden"
        );

        errorBox.style.display =
            "";

    }

    if (errorText) {
        errorText.textContent =
            message;
    }
}


function clearError() {

    if (errorBox) {

        errorBox.classList.add(
            "hidden"
        );

        errorBox.style.display =
            "none";
    }

    if (errorText) {
        errorText.textContent = "";
    }
}


/* =========================================================
   SERVER ERROR
   ========================================================= */

function handleServerError(message) {

    clearJoinTimeout();

    pendingJoin = null;
    pendingCreate = false;
    isRestoring = false;

    resetButtonLoading();

    /*
     * Server aynan shu xabarni bersa,
     * demak PostgreSQL / server tarafida
     * guruh mavjud emas.
     */

    if (
        message ===
        "Bunday guruh topilmadi."
    ) {

        const missingCode =
            currentRoom ||
            roomCodeInput?.value ||
            localStorage.getItem(
                STORAGE.ROOM_CODE
            );

        if (missingCode) {

            removeSavedGroup(
                String(
                    missingCode
                )
                    .trim()
                    .toUpperCase()
            );
        }

        localStorage.removeItem(
            STORAGE.ROOM_CODE
        );

        currentRoom = "";

        stopLocationSharing();
        clearMarkers();

        showSetup();

        showError(
            "Saqlangan guruh topilmadi. Yangi guruh yarating yoki yangi guruh kodini kiriting."
        );

        return;
    }

    const roomVisible =
        roomCard &&
        roomCard.style.display !==
            "none";

    showError(
        message
    );

    if (roomVisible) {

        updateLocationUI(
            "Ulanishda muammo"
        );
    }
}


/* =========================================================
   BUTTON LOADING
   ========================================================= */

function setButtonLoading(
    button,
    text
) {

    if (!button) {
        return;
    }

    if (
        !button.dataset.originalText
    ) {

        button.dataset.originalText =
            button.textContent;
    }

    button.disabled = true;

    button.classList.add(
        "loading"
    );

    button.textContent =
        text;
}


function resetButtonLoading() {

    const buttons = [
        createRoomBtn,
        joinRoomBtn
    ];

    buttons.forEach(button => {

        if (!button) {
            return;
        }

        button.disabled = false;

        button.classList.remove(
            "loading"
        );

        if (
            button.dataset.originalText
        ) {

            button.textContent =
                button.dataset.originalText;
        }
    });
}


/* =========================================================
   TEMP MESSAGE
   ========================================================= */

function showTemporaryMessage(
    message
) {

    let toast =
        document.getElementById(
            "liveGpsToast"
        );

    if (!toast) {

        toast =
            document.createElement(
                "div"
            );

        toast.id =
            "liveGpsToast";

        toast.style.position =
            "fixed";

        toast.style.left =
            "50%";

        toast.style.bottom =
            "24px";

        toast.style.transform =
            "translateX(-50%)";

        toast.style.zIndex =
            "99999";

        toast.style.padding =
            "11px 17px";

        toast.style.borderRadius =
            "14px";

        toast.style.background =
            "#17231c";

        toast.style.color =
            "#fff";

        toast.style.fontSize =
            "13px";

        toast.style.fontWeight =
            "700";

        toast.style.boxShadow =
            "0 10px 30px rgba(0,0,0,.22)";

        toast.style.opacity =
            "0";

        toast.style.transition =
            "opacity .2s ease";

        document.body.appendChild(
            toast
        );
    }

    toast.textContent =
        message;

    toast.style.opacity =
        "1";

    clearTimeout(
        toast._timer
    );

    toast._timer =
        setTimeout(() => {

            toast.style.opacity =
                "0";

        }, 1800);
}


/* =========================================================
   MARKERS CLEAR
   ========================================================= */

function clearMarkers() {

    if (map) {

        for (
            const marker
            of markerMap.values()
        ) {

            map.removeLayer(
                marker
            );
        }
    }

    markerMap.clear();

    lastUsers = [];

    if (membersList) {
        membersList.innerHTML = "";
    }

    if (membersCount) {
        membersCount.textContent = "0";
    }
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

            if (!isSocketReady()) {

                connectWebSocket();

            } else if (
                currentRoom
            ) {

                sendCurrentPosition();
            }
        }
    }
);


/* =========================================================
   WINDOW ONLINE
   ========================================================= */

window.addEventListener(
    "online",
    () => {

        if (!isSocketReady()) {
            connectWebSocket();
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
         * Bu yerda localStorage'dagi
         * guruh kodini O‘CHIRMAYMIZ.
         *
         * Shu sabab F5/reopen'dan keyin
         * saqlangan guruh qoladi.
         */

        stopLocationSharing();
    }
);
