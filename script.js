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

/*
 * Bir WebSocket ulanishida create/join
 * faqat bir marta yuboriladi.
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

const SAVED_GROUPS_KEY =
    "gps-saved-groups";


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
        name: name || "Guruh",
        savedAt: Date.now()
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
        "gps-user-name",
        finalName
    );

    localStorage.setItem(
        "gps-room-code",
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
        roomCode: normalized,
        name: finalName
    };


    /*
     * Yangi action bo‘lgani uchun
     * uni yana yuborishga ruxsat beramiz.
     */
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


    /*
     * HTML yuqorisidagi connectionPill
     * ham yangilanadi.
     */

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
   ERROR
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


    alert(message);
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


    alert(message);
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
     * WebSocket allaqachon ochiq bo‘lsa,
     * yangi create/join actionni yuboramiz.
     */

    if (
        ws &&
        ws.readyState === WebSocket.OPEN
    ) {

        pendingActionSent = false;

        sendPendingAction();

        return;
    }


    /*
     * Hozir ulanayotgan bo‘lsa,
     * yana yangi socket ochmaymiz.
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
             * BU YERDA ACTION YUBORILMAYDI.
             *
             * Serverdan "connected" kelgach
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


    /*
     * Bir socket ichida ikki marta yuborilmasin.
     */

    if (pendingActionSent) {
        return;
    }


    /* =====================================================
       CREATE ROOM
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

                type: "create-room",

                userId:
                    currentUserId || null,

                name
            })
        );


        pendingActionSent = true;

        return;
    }


    /* =====================================================
       JOIN ROOM
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

                type: "join-room",

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

        /*
         * Agar bizda saqlangan ID mavjud bo‘lsa,
         * uni yangi socket ID bilan almashtirmaymiz.
         *
         * Shu orqali F5/reconnect bir xil user
         * sifatida davom etadi.
         */

        if (
            !currentUserId &&
            data.userId
        ) {

            currentUserId =
                String(
                    data.userId
                );


            localStorage.setItem(
                "gps-user-id",
                currentUserId
            );
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
                "gps-user-id",
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
            "gps-room-code",
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


        renderUsers();


        showRoom();


        clearErrors();


        setConnectionStatus(
            "Ulangan",
            "online"
        );


        /*
         * Xona endi ko‘rinadigan bo‘ldi.
         * Xarita aynan shundan keyin ishga tushadi.
         */

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
         * Faqat bizda userId bo‘lmaganida
         * server ID'sini qabul qilamiz.
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
                "gps-user-id",
                currentUserId
            );
        }


        currentRoomCode =
            code;


        localStorage.setItem(
            "gps-room-code",
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


        /*
         * Avval xaritani ko‘rinadigan qilamiz,
         * keyin Yandex Maps'ni ishga tushiramiz.
         */

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


        /*
         * Action bajarilmadi.
         * Foydalanuvchi qayta bosishi mumkin.
         */

        pendingAction = null;
        pendingActionSent = false;


        const message =
            data.message ||
            "Xatolik yuz berdi.";


        /*
         * Qaysi sahifada bo‘lsak,
         * xatoni o‘sha joyda ko‘rsatamiz.
         */

        const roomVisible =
            $("roomCard") &&
            !$("roomCard").classList.contains(
                "hidden"
            );


        if (roomVisible) {

            showRoomError(
                message
            );

        } else {

            showSetupError(
                message
            );
        }


        return;
    }


    /* =====================================================
       LEFT ROOM
       ===================================================== */

    if (
        data.type === "left-room"
    ) {

        currentRoomCode = "";


        localStorage.removeItem(
            "gps-room-code"
        );


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
        "gps-user-name",
        name
    );


    /*
     * Eski roomni create paytida
     * yangi room bilan aralashtirmaymiz.
     */

    currentRoomCode = "";


    pendingAction = {

        type: "create",

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
        "gps-user-name",
        name
    );


    localStorage.setItem(
        "gps-room-code",
        roomCode
    );


    if (codeInput) {
        codeInput.value =
            roomCode;
    }


    pendingAction = {

        type: "join",

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
     * F5:
     * saqlangan xona mavjud bo‘lsa,
     * qayta ulanamiz.
     */

    if (
        currentRoomCode &&
        currentUserName
    ) {

        const normalized =
            normalizeRoomCode(
                currentRoomCode
            );


        if (
            /^[A-Z0-9]{6}$/.test(
                normalized
            )
        ) {

            pendingAction = {

                type: "join",

                roomCode: normalized,

                name:
                    currentUserName
            };


            pendingActionSent = false;


            connectWebSocket();

            return;
        }
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
                enableHighAccuracy: true,

                maximumAge: 5000,

                timeout: 15000
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

            type: "location",

            lat: myLatitude,

            lng: myLongitude,

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
        "gps-user-name",
        name
    );


    ws.send(
        JSON.stringify({

            type: "name",

            name
        })
    );
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
            user =>
                user.online
        );


    if (count) {

        count.textContent =
            String(
                onlineUsers.length
            );
    }


    if (!list) {
        return;
    }


    list.innerHTML = "";


    if (
        users.length === 0
    ) {

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

            distanceText =
                "Siz";

        } else if (

            Number.isFinite(
                Number(user.lat)
            ) &&

            Number.isFinite(
                Number(user.lng)
            ) &&

            Number.isFinite(
                myLatitude
            ) &&

            Number.isFinite(
                myLongitude
            )

        ) {

            const distance =
                calculateDistance(

                    myLatitude,

                    myLongitude,

                    Number(user.lat),

                    Number(user.lng)
                );


            distanceText =
                formatDistance(
                    distance
                );
        }


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
                    ${
                        distanceText ||
                        statusText
                    }
                </span>

            </div>

            <span
                class="member-status ${onlineClass}"
            >
                ${statusText}
            </span>
        `;


        list.appendChild(item);
    });
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

    const R = 6371000;


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
        return;
    }


    const mapElement =
        $("map");


    if (!mapElement) {
        return;
    }


    if (
        typeof ymaps3 ===
        "undefined"
    ) {

        console.error(
            "Yandex Maps yuklanmagan."
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

                        zoom: 12
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


        /*
         * Map DOM endi ko‘rinadigan holatda.
         */

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
   MARKER ELEMENT
   ========================================================= */

function createMarkerElement(
    user,
    isMe = false
) {

    const element =
        document.createElement("div");


    element.className =
        isMe
            ? "gps-marker gps-marker-me"
            : "gps-marker";


    element.innerHTML = `
        <div class="gps-marker-dot"></div>

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


            map.addChild(
                myMarker
            );

        } else {

            myMarker.update({
                coordinates:
                    position
            });
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
         * Faqat koordinatasi bor user.
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

                const marker =
                    userMarkers.get(id);


                marker.update({
                    coordinates:
                        position
                });

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
                    marker
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
     * Yo‘qolgan markerlarni o‘chiramiz.
     */

    for (
        const [
            id,
            marker
        ]
        of userMarkers.entries()
    ) {

        if (
            !activeIds.has(id)
        ) {

            try {

                map.removeChild(
                    marker
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
            const marker
            of userMarkers.values()
        ) {

            try {

                map.removeChild(
                    marker
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

        return;
    }


    if (
        !Number.isFinite(myLatitude) ||
        !Number.isFinite(myLongitude)
    ) {

        startLocationTracking();

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

        await navigator.clipboard.writeText(
            code
        );


        const button =
            $("copyRoomBtn");


        if (button) {

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

    if (
        ws &&
        ws.readyState === WebSocket.OPEN &&
        currentRoomCode
    ) {

        ws.send(
            JSON.stringify({
                type:
                    "leave-room"
            })
        );
    }


    currentRoomCode = "";


    localStorage.removeItem(
        "gps-room-code"
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
     * Avval eski guruhdan chiqamiz.
     */

    if (
        ws &&
        ws.readyState === WebSocket.OPEN &&
        currentRoomCode
    ) {

        ws.send(
            JSON.stringify({
                type:
                    "leave-room"
            })
        );
    }


    users = [];


    clearMapMarkers();


    stopLocationTracking();


    currentRoomCode =
        code;


    localStorage.setItem(
        "gps-room-code",
        code
    );


    pendingAction = {

        type: "join",

        roomCode: code,

        name
    };


    pendingActionSent = false;


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
        "gps-theme",
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
            "gps-theme"
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


    /* CREATE */

    const createButton =
        $("createRoomBtn");


    if (createButton) {

        createButton.addEventListener(
            "click",
            createRoom
        );
    }


    /* JOIN */

    const joinButton =
        $("joinRoomBtn");


    if (joinButton) {

        joinButton.addEventListener(
            "click",
            joinRoom
        );
    }


    /* COPY */

    const copyButton =
        $("copyRoomBtn");


    if (copyButton) {

        copyButton.addEventListener(
            "click",
            copyRoomCode
        );
    }


    /* MY LOCATION */

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


    /* CENTER */

    const centerButton =
        $("centerMapBtn");


    if (centerButton) {

        centerButton.addEventListener(
            "click",
            centerMapOnMe
        );
    }


    /* SWITCH */

    const switchButton =
        $("switchRoomBtn");


    if (switchButton) {

        switchButton.addEventListener(
            "click",
            switchRoom
        );
    }


    /* LEAVE */

    const leaveButton =
        $("leaveGroupBtn");


    if (leaveButton) {

        leaveButton.addEventListener(
            "click",
            leaveGroup
        );
    }


    /* THEME */

    const themeButton =
        $("themeBtn");


    if (themeButton) {

        themeButton.addEventListener(
            "click",
            toggleTheme
        );
    }


    /* NAME */

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
                    "gps-user-name",
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


    /* ROOM CODE */

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


    /* SWITCH INPUT */

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
   DEBUG
   ========================================================= */

window.GPS_DEBUG = {

    getState() {

        return {

            currentUserId,

            currentUserName,

            currentRoomCode,

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
            "gps-user-id"
        );

        localStorage.removeItem(
            "gps-user-name"
        );

        localStorage.removeItem(
            "gps-room-code"
        );

        location.reload();
    }
};


/* =========================================================
   START
   ========================================================= */

document.addEventListener(
    "DOMContentLoaded",
    async () => {

        const savedTheme =
            localStorage.getItem(
                "gps-theme"
            ) || "light";


        applyTheme(
            savedTheme
        );


        setupEvents();


        loadSavedGroups();


        /*
         * Xarita setup sahifasi yashirin emas,
         * lekin room xaritasi yashirin bo‘lishi mumkin.
         *
         * Shuning uchun session restore'dan oldin
         * xaritani majburan yaratmaymiz.
         */


        restoreSession();

    }
);
