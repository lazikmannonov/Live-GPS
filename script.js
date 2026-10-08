"use strict";

/* =========================================================
   SERVER
   ========================================================= */

const SERVER_URL =
    window.location.hostname === "localhost" ||
    window.location.hostname === "127.0.0.1"
        ? `${window.location.protocol}//${window.location.host}`
        : window.location.origin;


/* =========================================================
   STORAGE KEYS
   ========================================================= */

const SAVED_GROUPS_KEY = "gps-saved-groups";
const USER_ID_KEY = "gps-user-id";
const USER_NAME_KEY = "gps-user-name";
const ROOM_CODE_KEY = "gps-room-code";
const LAST_ROOM_KEY = "gps-last-room-code";
const THEME_KEY = "gps-theme";


/* =========================================================
   STATE
   ========================================================= */

let ws = null;

let currentUserId =
    localStorage.getItem(USER_ID_KEY) || null;

let currentUserName =
    localStorage.getItem(USER_NAME_KEY) || "";

let currentRoomCode =
    normalizeRoomCode(
        localStorage.getItem(ROOM_CODE_KEY) ||
        localStorage.getItem(LAST_ROOM_KEY) ||
        ""
    );

let pendingAction = null;

/*
 * Bitta WebSocket ulanishida
 * create/join faqat bir marta yuboriladi.
 */
let pendingActionSent = false;

let reconnectTimer = null;
let reconnectAttempts = 0;

let manuallyClosed = false;

let watchId = null;

let myLatitude = null;
let myLongitude = null;
let myAccuracy = null;

let map = null;
let mapInitialized = false;

let myMarker = null;

const userMarkers = new Map();

let users = [];

let savedGroups = [];

let eventsInitialized = false;

let firstLocationCentered = false;

let switchPendingAction = null;
let switchFallbackTimer = null;


/* =========================================================
   ELEMENT
   ========================================================= */

const $ = id =>
    document.getElementById(id);


/* =========================================================
   ROOM CODE
   ========================================================= */

function normalizeRoomCode(value) {

    return String(value || "")
        .trim()
        .toUpperCase()
        .replace(/[^A-Z0-9]/g, "")
        .slice(0, 6);
}


/* =========================================================
   USER ID VALIDATION
   ========================================================= */

function isValidUserId(value) {

    return /^[a-f0-9]{16}$/i.test(
        String(value || "")
    );
}


/* =========================================================
   HTML ESCAPE
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
   SAVED GROUPS
   ========================================================= */

function loadSavedGroups() {

    try {

        const data =
            localStorage.getItem(
                SAVED_GROUPS_KEY
            );

        const parsed =
            JSON.parse(
                data || "[]"
            );

        savedGroups =
            Array.isArray(parsed)
                ? parsed
                : [];

    } catch (error) {

        console.error(
            "Saved groups error:",
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


function addSavedGroup(
    roomCode,
    name
) {

    roomCode =
        normalizeRoomCode(roomCode);

    if (
        !/^[A-Z0-9]{6}$/.test(roomCode)
    ) {
        return;
    }

    name =
        String(
            name || "Guruh"
        )
            .trim()
            .slice(0, 100);

    savedGroups =
        savedGroups.filter(
            group =>
                group.code !== roomCode
        );

    savedGroups.unshift({

        code: roomCode,

        name:
            name || "Guruh",

        savedAt:
            Date.now()
    });

    if (
        savedGroups.length > 20
    ) {

        savedGroups =
            savedGroups.slice(0, 20);
    }

    saveSavedGroups();
    renderSavedGroups();
}


function removeSavedGroup(
    roomCode
) {

    roomCode =
        normalizeRoomCode(roomCode);

    savedGroups =
        savedGroups.filter(
            group =>
                group.code !== roomCode
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


    list.innerHTML = "";


    if (
        savedGroups.length === 0
    ) {

        list.innerHTML = `
            <div class="saved-empty">
                Saqlangan guruhlar yo‘q.
            </div>
        `;

        if (section) {
            section.style.display = "";
        }

        return;
    }


    if (section) {
        section.style.display = "";
    }


    savedGroups.forEach(group => {

        const item =
            document.createElement("div");

        item.className =
            "saved-group-item";


        item.innerHTML = `
            <div class="saved-group-info">

                <strong>
                    ${escapeHtml(
                        group.name || "Guruh"
                    )}
                </strong>

                <span>
                    ${escapeHtml(
                        group.code
                    )}
                </span>

            </div>

            <div class="saved-group-actions">

                <button
                    type="button"
                    class="saved-join-btn"
                >
                    Kirish
                </button>

                <button
                    type="button"
                    class="saved-delete-btn"
                    title="O‘chirish"
                >
                    ×
                </button>

            </div>
        `;


        const joinButton =
            item.querySelector(
                ".saved-join-btn"
            );


        const deleteButton =
            item.querySelector(
                ".saved-delete-btn"
            );


        if (joinButton) {

            joinButton.addEventListener(
                "click",
                () => {

                    const input =
                        $("roomCode");

                    if (input) {
                        input.value =
                            group.code;
                    }

                    joinSavedGroup(
                        group.code,
                        group.name
                    );
                }
            );
        }


        if (deleteButton) {

            deleteButton.addEventListener(
                "click",
                () => {

                    removeSavedGroup(
                        group.code
                    );
                }
            );
        }


        list.appendChild(item);
    });
}


/* =========================================================
   JOIN SAVED GROUP
   ========================================================= */

function joinSavedGroup(
    code,
    name
) {

    const normalized =
        normalizeRoomCode(code);


    if (
        !/^[A-Z0-9]{6}$/.test(normalized)
    ) {

        showSetupError(
            "Guruh kodi noto‘g‘ri."
        );

        return;
    }


    const nameInput =
        $("userName");


    const finalName =
        String(
            name ||
            currentUserName ||
            nameInput?.value ||
            ""
        )
            .trim()
            .slice(0, 100);


    if (!finalName) {

        showSetupError(
            "Avval ismingizni kiriting."
        );

        return;
    }


    currentUserName =
        finalName;

    currentRoomCode =
        normalized;


    localStorage.setItem(
        USER_NAME_KEY,
        finalName
    );

    localStorage.setItem(
        ROOM_CODE_KEY,
        normalized
    );

    localStorage.setItem(
        LAST_ROOM_KEY,
        normalized
    );


    if (nameInput) {
        nameInput.value =
            finalName;
    }


    const roomInput =
        $("roomCode");

    if (roomInput) {
        roomInput.value =
            normalized;
    }


    clearErrors();


    pendingAction = {

        type: "join",

        roomCode:
            normalized,

        name:
            finalName
    };


    pendingActionSent = false;


    connectWebSocket();
}


/* =========================================================
   STATUS
   ========================================================= */

function setConnectionStatus(
    text,
    type = ""
) {

    const element =
        $("connectionStatus");


    if (element) {

        element.textContent =
            text;

        element.classList.remove(
            "online",
            "offline",
            "connecting",
            "error"
        );

        if (type) {
            element.classList.add(type);
        }
    }


    const pill =
        $("connectionPill");

    const pillText =
        $("connectionText");


    if (pill) {

        pill.classList.remove(
            "online",
            "offline",
            "connecting",
            "error"
        );

        if (type) {
            pill.classList.add(type);
        }
    }


    if (pillText) {

        let topText =
            text;

        if (type === "online") {
            topText = "Online";
        }

        if (type === "offline") {
            topText = "Offline";
        }

        if (type === "connecting") {
            topText = "Ulanmoqda...";
        }

        pillText.textContent =
            topText;
    }
}


function setLocationStatus(
    text,
    type = ""
) {

    const element =
        $("locationStatus");


    if (!element) {
        return;
    }


    element.textContent =
        text;


    element.classList.remove(
        "online",
        "offline",
        "connecting",
        "error"
    );


    if (type) {

        element.classList.add(
            type
        );
    }
}


/* =========================================================
   ERRORS
   ========================================================= */

function showSetupError(
    message
) {

    const element =
        $("setupError");


    if (element) {

        element.textContent =
            message;

        element.style.display =
            "block";

        return;
    }


    console.error(
        message
    );
}


function showRoomError(
    message
) {

    const element =
        $("roomError");


    if (element) {

        element.textContent =
            message;

        element.style.display =
            "block";

        return;
    }


    console.error(
        message
    );
}


function clearSetupError() {

    const element =
        $("setupError");


    if (!element) {
        return;
    }


    element.textContent =
        "";

    element.style.display =
        "none";
}


function clearRoomError() {

    const element =
        $("roomError");


    if (!element) {
        return;
    }


    element.textContent =
        "";

    element.style.display =
        "none";
}


function clearErrors() {

    clearSetupError();
    clearRoomError();
}


/* =========================================================
   UI
   ========================================================= */

function showSetup() {

    const setup =
        $("setupCard");

    const room =
        $("roomCard");


    if (setup) {

        setup.classList.remove("hidden");
        setup.style.display = "";
    }


    if (room) {

        room.classList.add("hidden");
        room.style.display = "none";
    }


    clearRoomError();
}


function showRoom() {

    const setup =
        $("setupCard");

    const room =
        $("roomCard");


    if (setup) {

        setup.classList.add("hidden");
        setup.style.display = "none";
    }


    if (room) {

        room.classList.remove("hidden");
        room.style.display = "";
    }


    clearSetupError();


    /*
     * Room endi ko‘rinadigan bo‘lgandan keyin
     * mapni ishga tushiramiz.
     */

    requestAnimationFrame(() => {

        setTimeout(() => {

            initMap();

        }, 80);

    });
}


function updateRoomCodeUI(
    code
) {

    const normalized =
        normalizeRoomCode(code);


    const current =
        $("currentRoomCode");


    if (current) {

        current.textContent =
            normalized || "------";
    }


    const input =
        $("roomCode");


    if (
        input &&
        normalized
    ) {

        input.value =
            normalized;
    }


    const switchInput =
        $("switchRoomInput");


    if (
        switchInput &&
        normalized
    ) {

        switchInput.value =
            "";
    }
}


/* =========================================================
   WEBSOCKET URL
   ========================================================= */

function getWebSocketUrl() {

    const protocol =
        window.location.protocol ===
        "https:"
            ? "wss:"
            : "ws:";


    return (
        `${protocol}//${window.location.host}`
    );
}


/* =========================================================
   CONNECT WEBSOCKET
   ========================================================= */

function connectWebSocket() {

    manuallyClosed = false;


    /*
     * Socket ochiq bo‘lsa,
     * mavjud actionni yuboramiz.
     */

    if (
        ws &&
        ws.readyState === WebSocket.OPEN
    ) {

        sendPendingAction();

        return;
    }


    /*
     * Socket ulanayotgan bo‘lsa,
     * ikkinchi socket ochilmaydi.
     */

    if (
        ws &&
        ws.readyState === WebSocket.CONNECTING
    ) {

        return;
    }


    pendingActionSent = false;


    setConnectionStatus(
        "Ulanmoqda...",
        "connecting"
    );


    try {

        ws =
            new WebSocket(
                getWebSocketUrl()
            );

    } catch (error) {

        console.error(
            "WebSocket yaratish xatosi:",
            error
        );

        setConnectionStatus(
            "Ulanish xatosi",
            "error"
        );

        scheduleReconnect();

        return;
    }


    ws.addEventListener(
        "open",
        () => {

            reconnectAttempts = 0;


            setConnectionStatus(
                "Ulangan",
                "online"
            );

            /*
             * Action bu yerda yuborilmaydi.
             *
             * Server "connected" yuborgandan keyin
             * sendPendingAction() ishlaydi.
             */
        }
    );


    ws.addEventListener(
        "message",
        handleServerMessage
    );


    ws.addEventListener(
        "error",
        error => {

            console.error(
                "WebSocket error:",
                error
            );


            setConnectionStatus(
                "Ulanish xatosi",
                "error"
            );
        }
    );


    ws.addEventListener(
        "close",
        () => {

            pendingActionSent = false;


            setConnectionStatus(
                "Ulanish uzildi",
                "offline"
            );


            if (!manuallyClosed) {

                scheduleReconnect();
            }
        }
    );
}


/* =========================================================
   RECONNECT
   ========================================================= */

function scheduleReconnect() {

    if (manuallyClosed) {
        return;
    }


    if (reconnectTimer) {
        return;
    }


    reconnectAttempts++;


    const delay =
        Math.min(

            1000 *
            Math.pow(
                2,
                Math.min(
                    reconnectAttempts - 1,
                    5
                )
            ),

            10000
        );


    reconnectTimer =
        setTimeout(
            () => {

                reconnectTimer = null;

                connectWebSocket();

            },
            delay
        );
}


/* =========================================================
   SEND PENDING ACTION
   ========================================================= */

function sendPendingAction() {

    if (
        !ws ||
        ws.readyState !== WebSocket.OPEN
    ) {
        return;
    }


    if (!pendingAction) {
        return;
    }


    if (pendingActionSent) {
        return;
    }


    /* =====================================================
       CREATE
       ===================================================== */

    if (
        pendingAction.type === "create"
    ) {

        const name =
            String(
                pendingAction.name ||
                currentUserName ||
                "Noma'lum"
            )
                .trim()
                .slice(0, 100);


        if (!name) {
            return;
        }


        ws.send(
            JSON.stringify({

                type:
                    "create-room",

                userId:
                    currentUserId || null,

                name

            })
        );


        pendingActionSent = true;

        return;
    }


    /* =====================================================
       JOIN
       ===================================================== */

    if (
        pendingAction.type === "join"
    ) {

        const roomCode =
            normalizeRoomCode(
                pendingAction.roomCode
            );


        const name =
            String(
                pendingAction.name ||
                currentUserName ||
                "Noma'lum"
            )
                .trim()
                .slice(0, 100);


        if (
            !/^[A-Z0-9]{6}$/.test(
                roomCode
            )
        ) {
            return;
        }


        if (!name) {
            return;
        }


        ws.send(
            JSON.stringify({

                type:
                    "join-room",

                roomCode,

                userId:
                    currentUserId || null,

                name

            })
        );


        pendingActionSent = true;
    }
}


/* =========================================================
   SERVER MESSAGE
   ========================================================= */

function handleServerMessage(event) {

    let data = null;


    try {

        data =
            JSON.parse(
                event.data
            );

    } catch (error) {

        console.error(
            "Server JSON xatosi:",
            event.data
        );

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
    data.type === "connected"
) {

    if (
        !currentUserId &&
        isValidUserId(data.userId)
    ) {

        currentUserId =
            String(
                data.userId
            );

        localStorage.setItem(
            USER_ID_KEY,
            currentUserId
        );
    }


    if (
        !pendingAction &&
        currentRoomCode &&
        currentUserName
    ) {

        pendingAction = {

            type:
                "join",

            roomCode:
                currentRoomCode,

            name:
                currentUserName
        };

        pendingActionSent = false;
    }


    sendPendingAction();

    return;
}

    /* =====================================================
       ROOM CREATED
       ===================================================== */

    if (
        data.type === "room-created"
    ) {

        const code =
            normalizeRoomCode(
                data.roomCode
            );


        if (
            data.userId &&
            !currentUserId
        ) {

            currentUserId =
                String(
                    data.userId
                );


            localStorage.setItem(
                USER_ID_KEY,
                currentUserId
            );
        }


        if (
            !/^[A-Z0-9]{6}$/.test(code)
        ) {

            pendingAction = null;
            pendingActionSent = false;

            showSetupError(
                "Server noto‘g‘ri guruh kodi yubordi."
            );

            return;
        }


        currentRoomCode =
            code;


        localStorage.setItem(
            ROOM_CODE_KEY,
            code
        );

        localStorage.setItem(
            LAST_ROOM_KEY,
            code
        );


        addSavedGroup(
            code,
            currentUserName ||
            "Mening guruhim"
        );


        updateRoomCodeUI(code);


        pendingAction = null;
        pendingActionSent = false;


        users = [];


        clearMapMarkers();


        renderUsers();


        showRoom();


        clearErrors();


        setConnectionStatus(
            "Ulangan",
            "online"
        );


        firstLocationCentered = false;


        initMap();

        startLocationTracking();


        return;
    }


    /* =====================================================
       JOINED ROOM
       ===================================================== */

    if (
        data.type === "joined-room"
    ) {

        const code =
            normalizeRoomCode(
                data.roomCode
            );


        if (
            !/^[A-Z0-9]{6}$/.test(code)
        ) {

            pendingAction = null;
            pendingActionSent = false;

            showSetupError(
                "Server noto‘g‘ri guruh kodi yubordi."
            );

            showSetup();

            return;
        }


        /*
         * Server bergan ID faqat bizda
         * umuman ID bo‘lmasa qabul qilinadi.
         */

        if (
            data.userId &&
            !currentUserId
        ) {

            currentUserId =
                String(
                    data.userId
                );


            localStorage.setItem(
                USER_ID_KEY,
                currentUserId
            );
        }


        currentRoomCode =
            code;


        localStorage.setItem(
            ROOM_CODE_KEY,
            code
        );

        localStorage.setItem(
            LAST_ROOM_KEY,
            code
        );


        addSavedGroup(
            code,
            currentUserName ||
            "Guruh"
        );


        updateRoomCodeUI(code);


        pendingAction = null;
        pendingActionSent = false;


        clearErrors();


        showRoom();


        setConnectionStatus(
            "Ulangan",
            "online"
        );


        firstLocationCentered = false;


        initMap();

        startLocationTracking();


        return;
    }


    /* =====================================================
       USERS
       ===================================================== */

    if (
        data.type === "users"
    ) {

        users =
            Array.isArray(
                data.users
            )
                ? data.users
                : [];


        renderUsers();


        updateMapUsers();


        return;
    }


    /* =====================================================
       ERROR
       ===================================================== */

    if (
        data.type === "error"
    ) {

        console.error(
            "SERVER ERROR:",
            data.message
        );


        const message =
            data.message ||
            "Xatolik yuz berdi.";


        pendingAction = null;
        pendingActionSent = false;


        /*
         * Agar xona mavjud bo‘lmasa,
         * eski saqlangan xona avtomatik qayta-qayta
         * join bo‘lishining oldini olamiz.
         */

       if (
    message.includes(
        "Bunday guruh topilmadi"
    )
) {

    /*
     * MUHIM:
     *
     * Saqlangan guruhni o‘CHIRMAYMIZ.
     *
     * Render uxlab qolishi yoki server qayta
     * ishga tushishi sababli vaqtinchalik xato
     * chiqsa ham localStorage'dagi guruh saqlanadi.
     */

    pendingAction = null;
    pendingActionSent = false;

    showSetup();

    showSetupError(
        "Guruhga hozircha ulanib bo‘lmadi. Saqlangan guruh o‘chirilmagan. Keyinroq qayta urinib ko‘ring."
    );

    /*
     * ROOM_CODE va LAST_ROOM_KEY ham saqlanib qoladi.
     */

    return;
}
 
    }       
    /* =====================================================
       LEFT ROOM
       ===================================================== */

    if (
        data.type === "left-room"
    ) {

        /*
         * Muhim:
         *
         * ROOM CODE'NI O'CHIRMAYMIZ.
         *
         * Chunki foydalanuvchi keyinchalik saytga
         * qayta kirganda shu guruhga avtomatik
         * ulanadi.
         */

        currentRoomCode =
            "";


        localStorage.removeItem(
            ROOM_CODE_KEY
        );


        /*
         * Lekin oxirgi guruhni saqlab qolamiz.
         */

        /*
         * LAST_ROOM_KEY allaqachon saqlangan.
         */


        pendingAction = null;
        pendingActionSent = false;


        stopLocationTracking();


        users = [];


        renderUsers();


        clearMapMarkers();


        showSetup();


        setConnectionStatus(
            "Ulangan",
            "online"
        );


        if (switchPendingAction) {

            const nextAction =
                switchPendingAction;

            switchPendingAction = null;


            if (switchFallbackTimer) {

                clearTimeout(
                    switchFallbackTimer
                );

                switchFallbackTimer = null;
            }


            currentRoomCode =
                normalizeRoomCode(
                    nextAction.roomCode
                );


            localStorage.setItem(
                ROOM_CODE_KEY,
                currentRoomCode
            );

            localStorage.setItem(
                LAST_ROOM_KEY,
                currentRoomCode
            );


            pendingAction =
                nextAction;


            pendingActionSent = false;


            connectWebSocket();
        }


        return;
    }
}


/* =========================================================
   CREATE ROOM
   ========================================================= */

function createRoom() {

    clearErrors();


    const input =
        $("userName");


    const name =
        String(
            input?.value ||
            ""
        )
            .trim()
            .slice(0, 100);


    if (!name) {

        showSetupError(
            "Avval ismingizni kiriting."
        );

        input?.focus();

        return;
    }


    currentUserName =
        name;


    localStorage.setItem(
        USER_NAME_KEY,
        name
    );


    currentRoomCode = "";


    pendingAction = {

        type:
            "create",

        name
    };


    pendingActionSent = false;


    connectWebSocket();
}


/* =========================================================
   JOIN ROOM
   ========================================================= */

function joinRoom() {

    clearErrors();


    const nameInput =
        $("userName");

    const codeInput =
        $("roomCode");


    const name =
        String(
            nameInput?.value ||
            ""
        )
            .trim()
            .slice(0, 100);


    const roomCode =
        normalizeRoomCode(
            codeInput?.value
        );


    if (!name) {

        showSetupError(
            "Avval ismingizni kiriting."
        );

        nameInput?.focus();

        return;
    }


    if (
        !/^[A-Z0-9]{6}$/.test(
            roomCode
        )
    ) {

        showSetupError(
            "Guruh kodi 6 ta harf yoki raqamdan iborat bo‘lishi kerak."
        );

        codeInput?.focus();

        return;
    }


    currentUserName =
        name;


    currentRoomCode =
        roomCode;


    localStorage.setItem(
        USER_NAME_KEY,
        name
    );


    localStorage.setItem(
        ROOM_CODE_KEY,
        roomCode
    );


    localStorage.setItem(
        LAST_ROOM_KEY,
        roomCode
    );


    if (codeInput) {
        codeInput.value =
            roomCode;
    }


    pendingAction = {

        type:
            "join",

        roomCode,

        name
    };


    pendingActionSent = false;


    connectWebSocket();
}


/* =========================================================
   RESTORE SESSION
   ========================================================= */

function restoreSession() {

    loadSavedGroups();


    const nameInput =
        $("userName");


    if (
        nameInput &&
        currentUserName
    ) {

        nameInput.value =
            currentUserName;
    }


    /*
     * Avval asosiy room code.
     * Bo‘lmasa oxirgi guruhdan foydalanamiz.
     */

    const storedRoom =
        normalizeRoomCode(
            localStorage.getItem(
                ROOM_CODE_KEY
            ) ||
            localStorage.getItem(
                LAST_ROOM_KEY
            ) ||
            ""
        );


    /*
     * Eski versiyadagi room code bo‘lsa,
     * yana asosiy storage'ga qaytaramiz.
     */

    if (
        /^[A-Z0-9]{6}$/.test(storedRoom)
    ) {

        currentRoomCode =
            storedRoom;


        localStorage.setItem(
            LAST_ROOM_KEY,
            storedRoom
        );
    }


    /*
     * F5 yoki bir necha soatdan keyin
     * avtomatik qayta kirish.
     */

    if (
        currentRoomCode &&
        currentUserName
    ) {

        pendingAction = {

            type:
                "join",

            roomCode:
                currentRoomCode,

            name:
                currentUserName
        };


        pendingActionSent = false;


        setConnectionStatus(
            "Guruhga ulanmoqda...",
            "connecting"
        );


        connectWebSocket();


        return;
    }


    showSetup();
}


/* =========================================================
   LOCATION
   ========================================================= */

function startLocationTracking() {

    if (
        !navigator.geolocation
    ) {

        setLocationStatus(
            "GPS qo‘llab-quvvatlanmaydi",
            "error"
        );

        return;
    }


    if (
        watchId !== null
    ) {
        return;
    }


    setLocationStatus(
        "Joylashuv olinmoqda...",
        "connecting"
    );


    watchId =
        navigator.geolocation.watchPosition(

            position => {

                const coords =
                    position.coords;


                myLatitude =
                    Number(
                        coords.latitude
                    );


                myLongitude =
                    Number(
                        coords.longitude
                    );


                myAccuracy =
                    Number(
                        coords.accuracy
                    );


                setLocationStatus(
                    "Joylashuv aniqlandi",
                    "online"
                );


                updateMyMarker();


                sendLocation();


                renderUsers();
            },


            error => {

                console.error(
                    "GPS error:",
                    error
                );


                let message =
                    "Joylashuv olinmadi.";


                if (
                    error.code === 1
                ) {

                    message =
                        "Joylashuvga ruxsat berilmagan.";

                } else if (
                    error.code === 2
                ) {

                    message =
                        "Joylashuv aniqlanmadi.";

                } else if (
                    error.code === 3
                ) {

                    message =
                        "Joylashuv olish vaqti tugadi.";
                }


                setLocationStatus(
                    message,
                    "error"
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
        watchId !== null
    ) {

        navigator.geolocation.clearWatch(
            watchId
        );


        watchId = null;
    }


    myLatitude = null;
    myLongitude = null;
    myAccuracy = null;


    setLocationStatus(
        "Joylashuv o‘chirilgan",
        "offline"
    );
}


/* =========================================================
   SEND LOCATION
   ========================================================= */

function sendLocation() {

    if (
        !ws ||
        ws.readyState !== WebSocket.OPEN
    ) {
        return;
    }


    if (!currentRoomCode) {
        return;
    }


    if (
        !Number.isFinite(myLatitude) ||
        !Number.isFinite(myLongitude)
    ) {
        return;
    }


    ws.send(
        JSON.stringify({

            type:
                "location",

            lat:
                myLatitude,

            lng:
                myLongitude,

            accuracy:
                Number.isFinite(myAccuracy)
                    ? myAccuracy
                    : null
        })
    );
}


/* =========================================================
   NAME
   ========================================================= */

function sendName() {

    if (
        !ws ||
        ws.readyState !== WebSocket.OPEN
    ) {
        return;
    }


    if (!currentRoomCode) {
        return;
    }


    const input =
        $("userName");


    const name =
        String(
            input?.value ||
            currentUserName ||
            ""
        )
            .trim()
            .slice(0, 100);


    if (!name) {
        return;
    }


    currentUserName =
        name;


    localStorage.setItem(
        USER_NAME_KEY,
        name
    );


    ws.send(
        JSON.stringify({

            type:
                "name",

            name
        })
    );
}


/* =========================================================
   USERS UI
   ========================================================= */

function renderUsers() {

    const list = $("membersList");
    const count = $("membersCount");

    const onlineUsers = users.filter(
        user => user.online
    );

    if (count) {
        count.textContent = String(
            onlineUsers.length
        );
    }

    if (!list) {
        return;
    }

    list.innerHTML = "";

    if (users.length === 0) {

        list.innerHTML = `
            <div class="empty-members">
                Hozircha guruhda hech kim yo‘q.
            </div>
        `;

        return;
    }

    users.forEach(user => {

        const item =
            document.createElement("div");

        item.className =
            "member-item";

        const isMe =
            String(user.id) ===
            String(currentUserId);

        const onlineClass =
            user.online
                ? "online"
                : "offline";

        const statusText =
            user.online
                ? "Online"
                : "Offline";

        let distanceText = "";

        if (isMe) {

            distanceText = "Siz";

        } else if (

            Number.isFinite(Number(user.lat)) &&
            Number.isFinite(Number(user.lng)) &&
            Number.isFinite(myLatitude) &&
            Number.isFinite(myLongitude)

        ) {

            const distance =
                calculateDistance(

                    myLatitude,
                    myLongitude,

                    Number(user.lat),
                    Number(user.lng)
                );

            distanceText =
                formatDistance(distance);
        }

        const hasLocation =
            Number.isFinite(Number(user.lat)) &&
            Number.isFinite(Number(user.lng));

        const locationText =
            !isMe &&
            !user.online &&
            hasLocation

                ? "Oxirgi joylashuv saqlangan"

                : (
                    distanceText ||
                    statusText
                );

        item.innerHTML = `
            <div class="member-avatar">

                ${escapeHtml(
                    (
                        user.name ||
                        "N"
                    )
                        .charAt(0)
                        .toUpperCase()
                )}

            </div>

            <div class="member-info">

                <strong>

                    ${escapeHtml(
                        user.name ||
                        "Noma'lum"
                    )}

                    ${
                        isMe
                            ? " <small>(siz)</small>"
                            : ""
                    }

                </strong>

                <span>
                    ${escapeHtml(
                        locationText
                    )}
                </span>

            </div>

            <span
                class="member-status ${onlineClass}"
            >
                ${statusText}
            </span>
        `;

        /*
         * A'zo ustiga bosilganda
         * uning joylashuviga boramiz.
         */
           item.addEventListener(
            "click",
            () => {
                centerMapOnUser(user);
            }
        );

        list.appendChild(item);
    });
}

   /* =========================================================
   CENTER MAP ON USER
   ========================================================= */

function centerMapOnUser(user) {

    if (!user) {
        return;
    }

    const lat = Number(user.lat);
    const lng = Number(user.lng);

    if (
        !Number.isFinite(lat) ||
        !Number.isFinite(lng)
    ) {

        showRoomError(
            "Bu foydalanuvchining joylashuvi hali mavjud emas."
        );

        setTimeout(() => {
            clearRoomError();
        }, 2500);

        return;
    }

    /*
     * Xarita hali tayyor bo‘lmasa,
     * uni ishga tushiramiz.
     */

    if (!map) {

        initMap();

        setTimeout(() => {
            centerMapOnUser(user);
        }, 500);

        return;
    }

    const position = [
        lng,
        lat
    ];

    try {

        map.setLocation({
            center: position,
            zoom: 16,
            duration: 650
        });

    } catch (error) {

        console.error(
            "User center error:",
            error
        );
    }

    /*
     * Tanlangan marker nomini ochamiz.
     */

    const id =
        String(user.id);

    userMarkers.forEach(
        (data) => {

            data.element.classList.remove(
                "gps-marker-selected"
            );
        }
    );

    const markerData =
        userMarkers.get(id);

    if (markerData) {

        markerData.element.classList.add(
            "gps-marker-selected"
        );
    }

    /*
     * O‘zimizni tanlagan bo‘lsak,
     * o‘z markerimiz nomini ochamiz.
     */

    if (
        id === String(currentUserId) &&
        myMarker &&
        myMarker.__element
    ) {

        myMarker.__element.classList.add(
            "gps-marker-selected"
        );
    }
} 
 
/* =========================================================
   DISTANCE
   ========================================================= */

function calculateDistance(
    lat1,
    lon1,
    lat2,
    lon2
) {

    const R =
        6371000;


    const toRad =
        degrees =>
            degrees *
            Math.PI /
            180;


    const dLat =
        toRad(
            lat2 - lat1
        );


    const dLon =
        toRad(
            lon2 - lon1
        );


    const a =
        Math.sin(dLat / 2) ** 2 +

        Math.cos(
            toRad(lat1)
        ) *

        Math.cos(
            toRad(lat2)
        ) *

        Math.sin(dLon / 2) ** 2;


    const c =
        2 *
        Math.atan2(
            Math.sqrt(a),
            Math.sqrt(1 - a)
        );


    return R * c;
}


function formatDistance(
    meters
) {

    if (
        meters < 1000
    ) {

        return `${Math.round(meters)} m`;
    }


    return `${(
        meters / 1000
    ).toFixed(1)} km`;
}


/* =========================================================
   YANDEX MAP
   ========================================================= */

async function initMap() {

    if (
        mapInitialized
    ) {

        /*
         * Map allaqachon mavjud.
         * Markerlarni yangilaymiz.
         */

        updateMyMarker();
        updateMapUsers();

        return;
    }


    const mapElement =
        $("map");


    if (!mapElement) {
        return;
    }


    /*
     * Map hidden holatda bo‘lsa,
     * hozir yaratmaymiz.
     */

    const room =
        $("roomCard");


    if (
        room &&
        room.classList.contains("hidden")
    ) {
        return;
    }


    if (
        typeof ymaps3 ===
        "undefined"
    ) {

        console.warn(
            "Yandex Maps hali yuklanmagan. Qayta uriniladi."
        );


        setTimeout(
            () => {
                initMap();
            },
            700
        );


        return;
    }


    try {

        await ymaps3.ready;


        const {

            YMap,

            YMapDefaultSchemeLayer,

            YMapDefaultFeaturesLayer

        } = ymaps3;


        const center =
            Number.isFinite(myLatitude) &&
            Number.isFinite(myLongitude)

                ? [
                    myLongitude,
                    myLatitude
                ]

                : [
                    69.2401,
                    41.2995
                ];


        map =
            new YMap(

                mapElement,

                {

                    location: {

                        center,

                        zoom:
                            Number.isFinite(
                                myLatitude
                            )
                                ? 15
                                : 12
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


        setTimeout(
            () => {

                updateMyMarker();

                updateMapUsers();

            },
            100
        );


    } catch (error) {

        console.error(
            "Yandex map error:",
            error
        );
    }
}


/* =========================================================
   PREMIUM MARKER ELEMENT
   ========================================================= */

function createMarkerElement(
    user,
    isMe = false
) {

    const element =
        document.createElement("div");

    const online =
        isMe ||
        user.online !== false;

    element.className =
        isMe
            ? "gps-premium-marker gps-premium-marker-me"
            : "gps-premium-marker";

    const name =
        user.name ||
        (
            isMe
                ? "Siz"
                : "Noma'lum"
        );

    const initial =
        (
            user.name ||
            (
                isMe
                    ? "S"
                    : "N"
            )
        )
            .charAt(0)
            .toUpperCase();

    const statusText =
        isMe
            ? "Siz"
            : (
                online
                    ? "Online"
                    : "Offline"
            );

    element.innerHTML = `

        <div class="gps-marker-wrapper">

            <div class="gps-marker-card">

                <div class="gps-marker-avatar">

                    <span>
                        ${escapeHtml(initial)}
                    </span>

                    <i
                        class="
                            gps-marker-online
                            ${online ? "" : "offline"}
                        "
                    ></i>

                </div>

                <div class="gps-marker-content">

                    <div class="gps-marker-name">
                        ${escapeHtml(name)}
                    </div>

                    <div class="gps-marker-status">
                        ${escapeHtml(statusText)}
                    </div>

                </div>

            </div>

            <div class="gps-marker-pin">

                <div class="gps-marker-pin-inner"></div>

            </div>

        </div>
    `;

    /*
     * Marker bosilganda ismni ko‘rsatish/yashirish.
     */
    element.addEventListener(
        "click",
        event => {

            event.stopPropagation();

            const wasSelected =
                element.classList.contains(
                    "gps-marker-selected"
                );

            /*
             * Boshqa markerlarning
             * ochilgan nomlarini yopamiz.
             */
            if (isMe) {

                userMarkers.forEach(
                    data => {

                        data.element.classList.remove(
                            "gps-marker-selected"
                        );

                    }
                );

            } else {

                userMarkers.forEach(
                    data => {

                        data.element.classList.remove(
                            "gps-marker-selected"
                        );

                    }
                );
            }

            /*
             * Agar avval yopiq bo‘lgan bo‘lsa,
             * ochamiz.
             */
            if (!wasSelected) {

                element.classList.add(
                    "gps-marker-selected"
                );
            }
        }
    );

    return element;
}


/* =========================================================
   UPDATE MARKER CONTENT
   ========================================================= */

function updateMarkerElement(
    element,
    user,
    isMe = false
) {

    if (!element) {
        return;
    }

    const avatar =
        element.querySelector(
            ".gps-marker-avatar span"
        );

    const name =
        element.querySelector(
            ".gps-marker-name"
        );

    const status =
        element.querySelector(
            ".gps-marker-status"
        );

    const onlineDot =
        element.querySelector(
            ".gps-marker-online"
        );

    const initial =
        (
            user.name ||
            (
                isMe
                    ? "S"
                    : "N"
            )
        )
            .charAt(0)
            .toUpperCase();

    const online =
        isMe ||
        user.online !== false;

    if (avatar) {

        avatar.textContent =
            initial;
    }

    if (name) {

        name.textContent =
            user.name ||
            (
                isMe
                    ? "Siz"
                    : "Noma'lum"
            );
    }

    if (status) {

        status.textContent =
            isMe
                ? "Siz"
                : (
                    online
                        ? "Online"
                        : "Offline"
                );
    }

    if (onlineDot) {

        onlineDot.classList.toggle(
            "offline",
            !online
        );
    }
}

/* =========================================================
   MY MARKER
   ========================================================= */

function updateMyMarker() {

    if (
        !mapInitialized ||
        !map
    ) {
        return;
    }


    if (
        !Number.isFinite(myLatitude) ||
        !Number.isFinite(myLongitude)
    ) {
        return;
    }


    if (
        typeof ymaps3 ===
        "undefined"
    ) {
        return;
    }


    const position = [

        myLongitude,

        myLatitude
    ];


    const user = {

        id:
            currentUserId,

        name:
            currentUserName ||
            "Siz",

        lat:
            myLatitude,

        lng:
            myLongitude,

        online:
            true
    };


    try {

        if (!myMarker) {

            const markerElement =
                createMarkerElement(
                    user,
                    true
                );


            myMarker =
                new ymaps3.YMapMarker(

                    {
                        coordinates:
                            position
                    },

                    markerElement
                );


            myMarker.__element =
                markerElement;


            map.addChild(
                myMarker
            );


        } else {

            myMarker.update({

                coordinates:
                    position

            });


            updateMarkerElement(

                myMarker.__element,

                user,

                true
            );
        }


        /*
         * Birinchi aniq GPS kelganda
         * xaritani o‘zimizga markazlaymiz.
         */

        if (
            !firstLocationCentered
        ) {

            firstLocationCentered = true;


            try {

                map.setLocation({

                    center:
                        position,

                    zoom:
                        15,

                    duration:
                        600

                });

            } catch (error) {}
        }

    } catch (error) {

        console.error(
            "My marker error:",
            error
        );
    }
}


/* =========================================================
   MAP USERS
   ========================================================= */

function updateMapUsers() {

    if (
        !mapInitialized ||
        !map ||
        typeof ymaps3 === "undefined"
    ) {
        return;
    }


    const activeIds =
        new Set();


    users.forEach(user => {

        const id =
            String(
                user.id
            );


        /*
         * O'z markerimiz alohida.
         */

        if (
            id ===
            String(currentUserId)
        ) {
            return;
        }


        /*
         * Faqat koordinatasi mavjud
         * foydalanuvchilar xaritada ko‘rsatiladi.
         *
         * ONLINE ham,
         * OFFLINE ham.
         */

        if (
            !Number.isFinite(
                Number(user.lat)
            ) ||
            !Number.isFinite(
                Number(user.lng)
            )
        ) {
            return;
        }


        activeIds.add(id);


        const position = [

            Number(user.lng),

            Number(user.lat)

        ];


        try {

            if (
                userMarkers.has(id)
            ) {

                const markerData =
                    userMarkers.get(id);


                const marker =
                    markerData.marker;


                marker.update({

                    coordinates:
                        position

                });


                updateMarkerElement(

                    markerData.element,

                    user,

                    false
                );


            } else {

                const element =
                    createMarkerElement(
                        user,
                        false
                    );


                const marker =
                    new ymaps3.YMapMarker(

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

                    id,

                    {

                        marker,

                        element

                    }

                );
            }

        } catch (error) {

            console.error(
                "User marker error:",
                error
            );
        }
    });


    /*
     * Guruhdan butunlay yo‘qolgan user
     * markerini olib tashlaymiz.
     *
     * Offline user guruh ro‘yxatida bor bo‘lsa,
     * uning eski koordinatasi marker sifatida
     * saqlanadi.
     */

    for (
        const [
            id,
            markerData
        ]
        of userMarkers.entries()
    ) {

        if (
            !activeIds.has(id)
        ) {

            try {

                map.removeChild(
                    markerData.marker
                );

            } catch (error) {}


            userMarkers.delete(id);
        }
    }
}


/* =========================================================
   CLEAR MARKERS
   ========================================================= */

function clearMapMarkers() {

    if (
        map &&
        myMarker
    ) {

        try {

            map.removeChild(
                myMarker
            );

        } catch (error) {}
    }


    myMarker = null;


    if (map) {

        for (
            const markerData
            of userMarkers.values()
        ) {

            try {

                map.removeChild(
                    markerData.marker
                );

            } catch (error) {}
        }
    }


    userMarkers.clear();
}


/* =========================================================
   CENTER MAP
   ========================================================= */

function centerMapOnMe() {

    if (!map) {

        initMap();

        setTimeout(
            () => {
                centerMapOnMe();
            },
            300
        );

        return;
    }


    if (
        !Number.isFinite(myLatitude) ||
        !Number.isFinite(myLongitude)
    ) {

        startLocationTracking();

        setLocationStatus(
            "Joylashuv olinmoqda...",
            "connecting"
        );

        return;
    }


    try {

        map.setLocation({

            center: [

                myLongitude,

                myLatitude

            ],

            zoom:
                16,

            duration:
                500

        });

    } catch (error) {

        console.error(
            "Map center error:",
            error
        );
    }
}


/* =========================================================
   COPY ROOM CODE
   ========================================================= */

async function copyRoomCode() {

    const code =
        normalizeRoomCode(
            currentRoomCode
        );


    if (!code) {
        return;
    }


    try {

        if (
            navigator.clipboard &&
            navigator.clipboard.writeText
        ) {

            await navigator.clipboard.writeText(
                code
            );

        } else {

            throw new Error(
                "Clipboard API mavjud emas"
            );
        }


        const button =
            $("copyRoomBtn");


        const text =
            $("copyRoomText");


        if (text) {

            const oldText =
                text.textContent;


            text.textContent =
                "Nusxalandi";


            setTimeout(
                () => {

                    text.textContent =
                        oldText;

                },
                1500
            );

        } else if (button) {

            const oldText =
                button.innerHTML;


            button.innerHTML =
                `
                    <span>✓</span>
                    <span>Nusxalandi</span>
                `;


            setTimeout(
                () => {

                    button.innerHTML =
                        oldText;

                },
                1500
            );
        }

    } catch (error) {

        const textarea =
            document.createElement(
                "textarea"
            );


        textarea.value =
            code;


        textarea.style.position =
            "fixed";

        textarea.style.opacity =
            "0";


        document.body.appendChild(
            textarea
        );


        textarea.select();


        try {

            document.execCommand(
                "copy"
            );

        } catch (copyError) {}


        textarea.remove();
    }
}


/* =========================================================
   LEAVE GROUP
   ========================================================= */

function leaveGroup() {

    /*
     * Serverga leave yuboramiz.
     */

    if (
        ws &&
        ws.readyState === WebSocket.OPEN &&
        currentRoomCode
    ) {

        try {

            ws.send(
                JSON.stringify({

                    type:
                        "leave-room"

                })
            );

        } catch (error) {

            console.error(
                "Leave error:",
                error
            );
        }
    }


    /*
     * MUHIM:
     *
     * ROOM CODE butunlay o‘chirilmaydi.
     *
     * Oxirgi guruh LAST_ROOM_KEY ichida qoladi.
     *
     * Keyingi safar sayt ochilganda:
     *
     *   F5
     *   browser yopib ochish
     *   bir necha soat o‘tishi
     *
     * orqali yana shu guruhga avtomatik
     * ulanadi.
     */

    if (currentRoomCode) {

        localStorage.setItem(
            LAST_ROOM_KEY,
            currentRoomCode
        );
    }


    currentRoomCode = "";


    localStorage.removeItem(
        ROOM_CODE_KEY
    );


    pendingAction = null;
    pendingActionSent = false;


    users = [];


    stopLocationTracking();


    clearMapMarkers();


    renderUsers();


    showSetup();


    setConnectionStatus(
        "Ulangan",
        "online"
    );
}


/* =========================================================
   SWITCH ROOM
   ========================================================= */

function switchRoom() {

    clearErrors();


    const input =
        $("switchRoomInput");


    const code =
        normalizeRoomCode(
            input?.value
        );


    if (
        !/^[A-Z0-9]{6}$/.test(code)
    ) {

        showRoomError(
            "Guruh kodi noto‘g‘ri."
        );

        return;
    }


    const name =
        currentUserName ||
        String(
            $("userName")?.value ||
            ""
        )
            .trim();


    if (!name) {

        showRoomError(
            "Avval ismingizni kiriting."
        );

        return;
    }


    /*
     * Bir xil guruhga switch kerak emas.
     */

    if (
        normalizeRoomCode(
            currentRoomCode
        ) === code
    ) {

        showRoomError(
            "Siz hozir shu guruhdasiz."
        );

        return;
    }


    const nextAction = {

        type:
            "join",

        roomCode:
            code,

        name
    };


    /*
     * Avval eski guruhdan chiqamiz.
     */

    if (
        ws &&
        ws.readyState === WebSocket.OPEN &&
        currentRoomCode
    ) {

        switchPendingAction =
            nextAction;


        ws.send(
            JSON.stringify({

                type:
                    "leave-room"

            })
        );


        /*
         * Agar server left-room javobini kechiktirsa,
         * 1.5 soniyadan keyin baribir join qilamiz.
         */

        if (switchFallbackTimer) {

            clearTimeout(
                switchFallbackTimer
            );
        }


        switchFallbackTimer =
            setTimeout(
                () => {

                    if (
                        switchPendingAction
                    ) {

                        const action =
                            switchPendingAction;

                        switchPendingAction =
                            null;


                        currentRoomCode =
                            code;


                        localStorage.setItem(
                            ROOM_CODE_KEY,
                            code
                        );

                        localStorage.setItem(
                            LAST_ROOM_KEY,
                            code
                        );


                        pendingAction =
                            action;


                        pendingActionSent =
                            false;


                        connectWebSocket();
                    }

                },
                1500
            );


        return;
    }


    /*
     * Socket yo‘q bo‘lsa,
     * to‘g‘ridan-to‘g‘ri join.
     */

    currentRoomCode =
        code;


    localStorage.setItem(
        ROOM_CODE_KEY,
        code
    );

    localStorage.setItem(
        LAST_ROOM_KEY,
        code
    );


    pendingAction =
        nextAction;


    pendingActionSent =
        false;


    connectWebSocket();
}


/* =========================================================
   THEME
   ========================================================= */

function applyTheme(
    theme
) {

    const root =
        document.documentElement;


    if (
        theme === "dark"
    ) {

        root.classList.add("dark");

        document.body?.classList.add(
            "dark"
        );

    } else {

        root.classList.remove("dark");

        document.body?.classList.remove(
            "dark"
        );
    }


    localStorage.setItem(
        THEME_KEY,
        theme
    );


    const button =
        $("themeBtn");


    const icon =
        $("themeIcon");


    if (button) {

        button.setAttribute(

            "aria-label",

            theme === "dark"

                ? "Yorug‘ rejim"

                : "Tungi rejim"

        );
    }


    if (icon) {

        icon.textContent =
            theme === "dark"
                ? "☀"
                : "☾";

    } else if (button) {

        button.textContent =
            theme === "dark"
                ? "☀"
                : "☾";
    }
}


function toggleTheme() {

    const current =
        localStorage.getItem(
            THEME_KEY
        ) || "light";


    applyTheme(

        current === "dark"

            ? "light"

            : "dark"

    );
}


/* =========================================================
   EVENTS
   ========================================================= */

function setupEvents() {

    if (eventsInitialized) {
        return;
    }


    eventsInitialized = true;


    /* =====================================================
       CREATE
       ===================================================== */

    const createButton =
        $("createRoomBtn");


    if (createButton) {

        createButton.addEventListener(
            "click",
            createRoom
        );
    }


    /* =====================================================
       JOIN
       ===================================================== */

    const joinButton =
        $("joinRoomBtn");


    if (joinButton) {

        joinButton.addEventListener(
            "click",
            joinRoom
        );
    }


    /* =====================================================
       COPY
       ===================================================== */

    const copyButton =
        $("copyRoomBtn");


    if (copyButton) {

        copyButton.addEventListener(
            "click",
            copyRoomCode
        );
    }


    /* =====================================================
       MY LOCATION
       ===================================================== */

    const myLocationButton =
        $("myLocationBtn");


    if (myLocationButton) {

        myLocationButton.addEventListener(
            "click",
            () => {

                startLocationTracking();

                centerMapOnMe();

            }
        );
    }


    /* =====================================================
       CENTER
       ===================================================== */

    const centerButton =
        $("centerMapBtn");


    if (centerButton) {

        centerButton.addEventListener(
            "click",
            centerMapOnMe
        );
    }


    /* =====================================================
       SWITCH
       ===================================================== */

    const switchButton =
        $("switchRoomBtn");


    if (switchButton) {

        switchButton.addEventListener(
            "click",
            switchRoom
        );
    }


    /* =====================================================
       LEAVE
       ===================================================== */

    const leaveButton =
        $("leaveGroupBtn");


    if (leaveButton) {

        leaveButton.addEventListener(
            "click",
            leaveGroup
        );
    }


    /* =====================================================
       THEME
       ===================================================== */

    const themeButton =
        $("themeBtn");


    if (themeButton) {

        themeButton.addEventListener(
            "click",
            toggleTheme
        );
    }


    /* =====================================================
       NAME
       ===================================================== */

    const nameInput =
        $("userName");


    if (nameInput) {

        nameInput.addEventListener(
            "change",
            () => {

                currentUserName =
                    String(
                        nameInput.value ||
                        ""
                    )
                        .trim()
                        .slice(0, 100);


                localStorage.setItem(
                    USER_NAME_KEY,
                    currentUserName
                );


                if (
                    currentRoomCode
                ) {

                    sendName();
                }
            }
        );
    }


    /* =====================================================
       ROOM CODE
       ===================================================== */

    const roomInput =
        $("roomCode");


    if (roomInput) {

        roomInput.addEventListener(
            "input",
            () => {

                roomInput.value =
                    normalizeRoomCode(
                        roomInput.value
                    );


                clearSetupError();
            }
        );


        roomInput.addEventListener(
            "keydown",
            event => {

                if (
                    event.key === "Enter"
                ) {

                    event.preventDefault();

                    joinRoom();
                }
            }
        );
    }


    /* =====================================================
       SWITCH INPUT
       ===================================================== */

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


                clearRoomError();
            }
        );


        switchInput.addEventListener(
            "keydown",
            event => {

                if (
                    event.key === "Enter"
                ) {

                    event.preventDefault();

                    switchRoom();
                }
            }
        );
    }
}


/* =========================================================
   PREMIUM MARKER CSS
   ========================================================= */

function injectPremiumMarkerStyle() {

    if (
        $("premium-gps-marker-style")
    ) {
        return;
    }


    const style =
        document.createElement("style");


    style.id =
        "premium-gps-marker-style";


    style.textContent = `

        .gps-premium-marker {

            position: relative;

            width: 155px;
            height: 90px;

            display: flex;

            justify-content: center;

            align-items: flex-start;

            pointer-events: auto;

            transform:
                translate(-50%, -100%);

            font-family:
                Inter,
                -apple-system,
                BlinkMacSystemFont,
                "Segoe UI",
                sans-serif;

            z-index: 10;

            transition:
                transform .25s ease,
                filter .25s ease;
        }


        .gps-premium-marker:hover {

            transform:
                translate(-50%, -100%)
                scale(1.06);

            z-index: 100;
        }


        .gps-marker-wrapper {

            position: relative;

            display: flex;

            flex-direction: column;

            align-items: center;
        }


        .gps-marker-card {

            position: relative;

            min-width: 125px;
            max-width: 155px;

            height: 52px;

            padding:
                6px 10px 6px 7px;

            display: flex;

            align-items: center;

            gap: 8px;

            border-radius: 17px;

            background:
                rgba(255,255,255,.97);

            border:
                1px solid
                rgba(255,255,255,.9);

            box-shadow:

                0 10px 35px
                rgba(0,0,0,.18),

                0 3px 10px
                rgba(0,0,0,.10),

                inset 0 1px 0
                rgba(255,255,255,.95);

            backdrop-filter:
                blur(18px);

            -webkit-backdrop-filter:
                blur(18px);

            white-space: nowrap;

            overflow: hidden;
        }

.gps-marker-card {

    opacity: 0;

    visibility: hidden;

    transform:
        translateY(8px)
        scale(.92);

    pointer-events: none;

    transition:
        opacity .2s ease,
        transform .2s ease,
        visibility .2s ease;
}


.gps-premium-marker:hover
.gps-marker-card {

    opacity: 0;

    visibility: hidden;
}


/*
 * Faqat bosilganda ism chiqadi.
 */
.gps-premium-marker.gps-marker-selected
.gps-marker-card {

    opacity: 1;

    visibility: visible;

    transform:
        translateY(0)
        scale(1);

    pointer-events: auto;
}

        .gps-marker-avatar {

            position: relative;

            width: 37px;
            height: 37px;

            min-width: 37px;

            border-radius: 50%;

            display: flex;

            align-items: center;
            justify-content: center;

            color: #fff;

            font-size: 14px;

            font-weight: 800;

            background:
                linear-gradient(
                    145deg,
                    #22c55e,
                    #16a34a
                );

            box-shadow:

                0 5px 15px
                rgba(22,163,74,.35),

                inset 0 1px 1px
                rgba(255,255,255,.4);
        }


        .gps-marker-avatar span {

            position: relative;

            z-index: 2;
        }


        .gps-marker-online {

            position: absolute;

            right: -1px;
            bottom: -1px;

            width: 11px;
            height: 11px;

            border-radius: 50%;

            background:
                #22c55e;

            border:
                2px solid #fff;

            box-shadow:
                0 0 0 3px
                rgba(34,197,94,.13),

                0 0 10px
                rgba(34,197,94,.65);

            animation:
                gps-online-pulse 2s infinite;
        }


        .gps-marker-online.offline {

            background:
                #9ca3af;

            box-shadow:
                0 0 0 2px
                rgba(156,163,175,.12);

            animation: none;
        }


        @keyframes gps-online-pulse {

            0%,
            100% {

                box-shadow:
                    0 0 0 2px
                    rgba(34,197,94,.10),

                    0 0 7px
                    rgba(34,197,94,.45);
            }

            50% {

                box-shadow:
                    0 0 0 5px
                    rgba(34,197,94,.08),

                    0 0 14px
                    rgba(34,197,94,.75);
            }
        }


        .gps-marker-content {

            min-width: 0;

            display: flex;

            flex-direction: column;

            justify-content: center;
        }


        .gps-marker-name {

            max-width: 94px;

            overflow: hidden;

            text-overflow: ellipsis;

            white-space: nowrap;

            color:
                #17201c;

            font-size:
                13px;

            font-weight:
                750;

            line-height:
                1.2;
        }


        .gps-marker-status {

            margin-top: 2px;

            color:
                #647067;

            font-size:
                10px;

            font-weight:
                600;

            line-height:
                1;
        }


        .gps-marker-pin {

            position: relative;

            width: 18px;
            height: 18px;

            margin-top: -4px;

            transform:
                rotate(45deg);

            border-radius:
                4px 4px 5px 4px;

            background:
                rgba(255,255,255,.97);

            box-shadow:
                4px 4px 11px
                rgba(0,0,0,.12);
        }


        .gps-marker-pin-inner {

            position: absolute;

            left: 50%;
            top: 50%;

            width: 8px;
            height: 8px;

            transform:
                translate(-50%, -50%);

            border-radius: 50%;

            background:
                #19d66b;

            box-shadow:
                0 0 12px
                rgba(25,214,107,.7);
        }


        .gps-premium-marker-me {

            z-index: 30;
        }


        .gps-premium-marker-me
        .gps-marker-card {

            border:
                1px solid
                rgba(25,214,107,.38);

            box-shadow:

                0 12px 40px
                rgba(25,214,107,.20),

                0 4px 13px
                rgba(0,0,0,.12),

                inset 0 1px 0
                rgba(255,255,255,.95);
        }


        .gps-premium-marker-me
        .gps-marker-avatar {

            background:
                linear-gradient(
                    145deg,
                    #19d66b,
                    #0fa958
                );

            box-shadow:

                0 5px 17px
                rgba(25,214,107,.42),

                inset 0 1px 1px
                rgba(255,255,255,.42);
        }


        .gps-premium-marker-me
        .gps-marker-pin-inner {

            background:
                #19d66b;

            box-shadow:
                0 0 15px
                rgba(25,214,107,.9);
        }


        .dark
        .gps-marker-card,

        body.dark
        .gps-marker-card {

            background:
                rgba(25,31,28,.97);

            border:
                1px solid
                rgba(255,255,255,.10);

            box-shadow:

                0 12px 40px
                rgba(0,0,0,.45),

                inset 0 1px 0
                rgba(255,255,255,.06);
        }


        .dark
        .gps-marker-name,

        body.dark
        .gps-marker-name {

            color:
                #f3f7f5;
        }


        .dark
        .gps-marker-status,

        body.dark
        .gps-marker-status {

            color:
                #9ca9a1;
        }


        .dark
        .gps-marker-pin,

        body.dark
        .gps-marker-pin {

            background:
                rgba(25,31,28,.97);

            box-shadow:
                4px 4px 13px
                rgba(0,0,0,.4);
        }


        @media (max-width: 600px) {

            .gps-premium-marker {

                width: 135px;
                height: 82px;
            }


            .gps-marker-card {

                min-width: 110px;

                height: 46px;

                padding:
                    5px 8px 5px 6px;

                gap: 7px;

                border-radius: 15px;
            }


            .gps-marker-avatar {

                width: 33px;
                height: 33px;

                min-width: 33px;

                font-size: 12px;
            }


            .gps-marker-online {

                width: 10px;
                height: 10px;
            }


            .gps-marker-name {

                max-width: 78px;

                font-size: 12px;
            }


            .gps-marker-status {

                font-size: 9px;
            }


            .gps-marker-pin {

                width: 16px;
                height: 16px;
            }


            .gps-marker-pin-inner {

                width: 7px;
                height: 7px;
            }
        }

    `;


    document.head.appendChild(
        style
    );
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

            lastRoomCode:
                localStorage.getItem(
                    LAST_ROOM_KEY
                ),

            pendingAction,

            pendingActionSent,

            connected:
                !!(
                    ws &&
                    ws.readyState ===
                    WebSocket.OPEN
                ),

            users,

            savedGroups,

            mapInitialized,

            myLocation: {

                lat:
                    myLatitude,

                lng:
                    myLongitude,

                accuracy:
                    myAccuracy
            }
        };
    },


    reconnect() {

        manuallyClosed = false;

        pendingActionSent = false;

        connectWebSocket();
    },


    clearSession() {

        localStorage.removeItem(
            USER_ID_KEY
        );

        localStorage.removeItem(
            USER_NAME_KEY
        );

        localStorage.removeItem(
            ROOM_CODE_KEY
        );

        localStorage.removeItem(
            LAST_ROOM_KEY
        );

        location.reload();
    }
};


/* =========================================================
   START
   ========================================================= */

document.addEventListener(
    "DOMContentLoaded",
    () => {

        const savedTheme =
            localStorage.getItem(
                THEME_KEY
            ) || "light";


        applyTheme(
            savedTheme
        );


        /*
         * Premium marker CSS.
         */

        injectPremiumMarkerStyle();


        /*
         * Eventlar.
         */

        setupEvents();


        /*
         * Session.
         */

        restoreSession();

    }
);
