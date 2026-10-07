"use strict";

/*
=========================================================
LIVE GPS
Frontend <-> server.js
Stable Map Version
=========================================================
*/


/* ======================================================
   DOM
====================================================== */

const setupCard = document.getElementById("setupCard");
const roomCard = document.getElementById("roomCard");

const nameInput = document.getElementById("nameInput");
const roomCodeInput = document.getElementById("roomCodeInput");

const createRoomBtn = document.getElementById("createRoomBtn");
const joinRoomBtn = document.getElementById("joinRoomBtn");

const currentRoomCode = document.getElementById("currentRoomCode");
const copyRoomBtn = document.getElementById("copyRoomBtn");
const copyRoomText = document.getElementById("copyRoomText");

const connectionStatus = document.getElementById("connectionStatus");
const locationStatus = document.getElementById("locationStatus");

const connectionPill = document.getElementById("connectionPill");
const connectionText = document.getElementById("connectionText");

const membersList = document.getElementById("membersList");
const memberCount = document.getElementById("memberCount");

const switchRoomInput = document.getElementById("switchRoomInput");
const switchRoomBtn = document.getElementById("switchRoomBtn");

const themeBtn = document.getElementById("themeBtn");
const themeIcon = document.getElementById("themeIcon");

const setupError = document.getElementById("setupError");
const roomError = document.getElementById("roomError");

const myLocationBtn = document.getElementById("myLocationBtn");
const mapResetBtn = document.getElementById("mapResetBtn");


/* ======================================================
   STORAGE
====================================================== */

const STORAGE_NAME = "live-gps-user-name";
const STORAGE_ROOM = "live-gps-room-code";
const STORAGE_THEME = "live-gps-theme";


/* ======================================================
   STATE
====================================================== */

let socket = null;

let myUserId = null;

let currentName = "";
let currentRoom = "";

let reconnectTimer = null;
let reconnectDelay = 1000;

let watchId = null;

let map = null;

let lightTile = null;

let markers = new Map();
let accuracyCircles = new Map();

let currentPosition = null;

let lastUsers = [];

let isRestoring = false;
let locationStarted = false;

let hasCenteredOnOwnLocation = false;


/* ======================================================
   START
====================================================== */

document.addEventListener("DOMContentLoaded", function(){

    loadTheme();

    bindEvents();

    connectWebSocket();

});


/* ======================================================
   EVENTS
====================================================== */

function bindEvents(){

    if(createRoomBtn){
        createRoomBtn.addEventListener("click", createRoom);
    }

    if(joinRoomBtn){
        joinRoomBtn.addEventListener("click", joinRoom);
    }

    if(copyRoomBtn){
        copyRoomBtn.addEventListener("click", copyRoomCode);
    }

    if(switchRoomBtn){
        switchRoomBtn.addEventListener(
            "click",
            switchToAnotherRoom
        );
    }

    if(themeBtn){
        themeBtn.addEventListener(
            "click",
            toggleTheme
        );
    }

    if(myLocationBtn){
        myLocationBtn.addEventListener(
            "click",
            moveToMyLocation
        );
    }

    if(mapResetBtn){
        mapResetBtn.addEventListener(
            "click",
            fitGroupOnMap
        );
    }

    if(roomCodeInput){

        roomCodeInput.addEventListener(
            "input",
            function(){

                roomCodeInput.value =
                    roomCodeInput.value
                        .toUpperCase()
                        .replace(/[^A-Z0-9]/g,"")
                        .slice(0,6);

            }
        );

        roomCodeInput.addEventListener(
            "keydown",
            function(event){

                if(event.key === "Enter"){
                    joinRoom();
                }

            }
        );
    }

    if(switchRoomInput){

        switchRoomInput.addEventListener(
            "input",
            function(){

                switchRoomInput.value =
                    switchRoomInput.value
                        .toUpperCase()
                        .replace(/[^A-Z0-9]/g,"")
                        .slice(0,6);

            }
        );

        switchRoomInput.addEventListener(
            "keydown",
            function(event){

                if(event.key === "Enter"){
                    switchToAnotherRoom();
                }

            }
        );
    }

    if(nameInput){

        nameInput.addEventListener(
            "keydown",
            function(event){

                if(event.key === "Enter"){
                    createRoom();
                }

            }
        );
    }
}


/* ======================================================
   WEBSOCKET
====================================================== */

function getWebSocketUrl(){

    const protocol =
        location.protocol === "https:"
            ? "wss:"
            : "ws:";

    return protocol + "//" + location.host;
}


function connectWebSocket(){

    if(socket){

        try{
            socket.close();
        }catch(error){}

    }


    updateConnectionUI(
        false,
        "Ulanmoqda..."
    );


    console.log(
        "WebSocket ulanmoqda..."
    );


    try{

        socket = new WebSocket(
            getWebSocketUrl()
        );

    }catch(error){

        console.error(error);

        scheduleReconnect();

        return;
    }


    socket.addEventListener(
        "open",
        function(){

            console.log(
                "WebSocket ulandi."
            );

            reconnectDelay = 1000;

            updateConnectionUI(
                true,
                "Online"
            );

            setConnectionStatus(
                "Ulangan"
            );

            restoreSession();

        }
    );


    socket.addEventListener(
        "message",
        function(event){

            let data;

            try{

                data =
                    JSON.parse(
                        event.data
                    );

            }catch(error){

                console.error(
                    "Server JSON xatosi:",
                    error
                );

                return;
            }


            console.log(
                "SERVER:",
                data
            );


            handleServerMessage(
                data
            );

        }
    );


    socket.addEventListener(
        "close",
        function(){

            console.log(
                "WebSocket uzildi."
            );


            updateConnectionUI(
                false,
                "Offline"
            );


            setConnectionStatus(
                "Ulanish uzildi"
            );


            scheduleReconnect();

        }
    );


    socket.addEventListener(
        "error",
        function(error){

            console.error(
                "WebSocket xatosi:",
                error
            );

        }
    );
}


function scheduleReconnect(){

    if(reconnectTimer){
        return;
    }


    reconnectTimer =
        setTimeout(
            function(){

                reconnectTimer = null;

                reconnectDelay =
                    Math.min(
                        reconnectDelay * 1.5,
                        10000
                    );

                connectWebSocket();

            },
            reconnectDelay
        );
}


function isSocketReady(){

    return socket &&
           socket.readyState === WebSocket.OPEN;
}


function send(data){

    if(!isSocketReady()){

        showError(
            "Aloqa hali tayyor emas. Bir oz kuting.",
            roomCard &&
            roomCard.classList.contains("hidden")
                ? setupError
                : roomError
        );

        return false;
    }


    try{

        socket.send(
            JSON.stringify(data)
        );

        return true;

    }catch(error){

        console.error(
            "WebSocket send xatosi:",
            error
        );

        return false;
    }
}


/* ======================================================
   SERVER MESSAGES
====================================================== */

function handleServerMessage(data){

    if(!data || !data.type){
        return;
    }


    if(data.type === "connected"){

        myUserId = data.id;

        console.log(
            "Mening user ID:",
            myUserId
        );

        return;
    }


    if(data.type === "room-created"){

        myUserId =
            data.userId || myUserId;

        currentRoom =
            String(
                data.roomCode || ""
            )
            .toUpperCase();

        saveSession();

        showRoom(
            currentRoom
        );

        clearErrors();

        return;
    }


    if(data.type === "joined-room"){

        myUserId =
            data.userId || myUserId;

        currentRoom =
            String(
                data.roomCode || ""
            )
            .toUpperCase();

        saveSession();

        showRoom(
            currentRoom
        );

        clearErrors();

        return;
    }


    if(data.type === "users"){

        lastUsers =
            Array.isArray(data.users)
                ? data.users
                : [];

        renderUsers(
            lastUsers
        );

        return;
    }


    if(data.type === "error"){

        handleServerError(
            data.message ||
            "Noma'lum xatolik."
        );

        return;
    }
}


/* ======================================================
   CREATE ROOM
====================================================== */

function createRoom(){

    clearErrors();


    const name =
        String(
            nameInput
                ? nameInput.value
                : ""
        )
        .trim();


    if(!name){

        showError(
            "Avval ismingizni kiriting.",
            setupError
        );

        if(nameInput){
            nameInput.focus();
        }

        return;
    }


    if(name.length < 2){

        showError(
            "Ism kamida 2 ta belgidan iborat bo‘lsin.",
            setupError
        );

        return;
    }


    currentName = name;


    localStorage.setItem(
        STORAGE_NAME,
        currentName
    );


    if(!isSocketReady()){

        showError(
            "Server bilan aloqa o‘rnatilmoqda. Bir oz kuting.",
            setupError
        );

        return;
    }


    setButtonLoading(
        createRoomBtn,
        true,
        "Yaratilmoqda..."
    );


    send({
        type:"create-room",
        name:currentName
    });


    setTimeout(
        function(){

            setButtonLoading(
                createRoomBtn,
                false,
                "Yangi guruh yaratish"
            );

        },
        1500
    );
}


/* ======================================================
   JOIN ROOM
====================================================== */

function joinRoom(){

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


    if(!name){

        showError(
            "Avval ismingizni kiriting.",
            setupError
        );

        if(nameInput){
            nameInput.focus();
        }

        return;
    }


    if(code.length !== 6){

        showError(
            "Guruh kodi 6 ta belgidan iborat bo‘lishi kerak.",
            setupError
        );

        if(roomCodeInput){
            roomCodeInput.focus();
        }

        return;
    }


    currentName = name;


    localStorage.setItem(
        STORAGE_NAME,
        currentName
    );


    if(!isSocketReady()){

        showError(
            "Server bilan aloqa o‘rnatilmoqda. Bir oz kuting.",
            setupError
        );

        return;
    }


    setButtonLoading(
        joinRoomBtn,
        true,
        "Ulanilmoqda..."
    );


    send({
        type:"join-room",
        name:currentName,
        roomCode:code
    });


    setTimeout(
        function(){

            setButtonLoading(
                joinRoomBtn,
                false,
                "Guruhga qo‘shilish"
            );

        },
        1500
    );
}


/* ======================================================
   SWITCH ROOM
====================================================== */

function switchToAnotherRoom(){

    const code =
        String(
            switchRoomInput
                ? switchRoomInput.value
                : ""
        )
        .trim()
        .toUpperCase();


    if(code.length !== 6){

        showError(
            "Guruh kodi 6 ta belgidan iborat bo‘lishi kerak.",
            roomError
        );

        return;
    }


    if(!isSocketReady()){

        showError(
            "Server bilan aloqa uzilgan.",
            roomError
        );

        return;
    }


    clearMarkers();

    hasCenteredOnOwnLocation = false;

    currentRoom = code;


    send({
        type:"join-room",
        name:currentName,
        roomCode:code
    });
}


/* ======================================================
   RESTORE SESSION
====================================================== */

function restoreSession(){

    if(isRestoring){
        return;
    }


    isRestoring = true;


    const savedName =
        String(
            localStorage.getItem(
                STORAGE_NAME
            ) || ""
        )
        .trim();


    const savedRoom =
        String(
            localStorage.getItem(
                STORAGE_ROOM
            ) || ""
        )
        .trim()
        .toUpperCase();


    if(nameInput && savedName){

        nameInput.value =
            savedName;

    }


    if(
        savedName &&
        savedRoom &&
        savedRoom.length === 6
    ){

        currentName =
            savedName;

        currentRoom =
            savedRoom;


        send({
            type:"join-room",
            name:savedName,
            roomCode:savedRoom
        });
    }


    setTimeout(
        function(){

            isRestoring = false;

        },
        500
    );
}


/* ======================================================
   SHOW ROOM
====================================================== */

function showRoom(code){

    currentRoom =
        String(code || "")
            .toUpperCase();


    if(currentRoomCode){

        currentRoomCode.textContent =
            currentRoom || "------";

    }


    if(setupCard){

        setupCard.classList.add(
            "hidden"
        );

    }


    if(roomCard){

        roomCard.classList.remove(
            "hidden"
        );

    }


    localStorage.setItem(
        STORAGE_ROOM,
        currentRoom
    );


    if(switchRoomInput){

        switchRoomInput.value = "";

    }


    initializeMap();


    /*
    Muhim:
    CSS/DOM o‘zgarishidan keyin
    Leaflet xarita o‘lchamini qayta hisoblaydi.
    */

    refreshMapSize();


    startLocationSharing();


    setConnectionStatus(
        "Ulangan"
    );
}


/* ======================================================
   LOCATION
====================================================== */

function startLocationSharing(){

    if(locationStarted){
        return;
    }


    if(!navigator.geolocation){

        setLocationStatus(
            "GPS mavjud emas"
        );

        return;
    }


    locationStarted = true;


    setLocationStatus(
        "GPS kutilmoqda..."
    );


    watchId =
        navigator.geolocation.watchPosition(
            handlePosition,
            handleLocationError,
            {
                enableHighAccuracy:true,
                maximumAge:3000,
                timeout:15000
            }
        );
}


function stopLocationSharing(){

    if(
        watchId !== null &&
        navigator.geolocation
    ){

        navigator.geolocation.clearWatch(
            watchId
        );
    }


    watchId = null;

    locationStarted = false;
}


function handlePosition(position){

    const lat =
        Number(
            position.coords.latitude
        );


    const lng =
        Number(
            position.coords.longitude
        );


    const accuracy =
        Number(
            position.coords.accuracy || 0
        );


    if(
        !Number.isFinite(lat) ||
        !Number.isFinite(lng)
    ){

        return;
    }


    currentPosition = {
        lat:lat,
        lng:lng,
        accuracy:accuracy
    };


    setLocationStatus(
        accuracy > 0
            ? "GPS ± " +
              Math.round(accuracy) +
              " m"
            : "GPS faol"
    );


    send({
        type:"location",
        lat:lat,
        lng:lng,
        accuracy:accuracy
    });


    updateOwnMarker(
        lat,
        lng,
        accuracy
    );


    /*
    Birinchi GPS koordinata olinganda
    xaritani foydalanuvchiga markazlaymiz.
    */

    if(
        map &&
        !hasCenteredOnOwnLocation
    ){

        hasCenteredOnOwnLocation = true;

        map.flyTo(
            [lat,lng],
            16,
            {
                duration:1
            }
        );

    }
}


function handleLocationError(error){

    console.warn(
        "GPS xatosi:",
        error
    );


    if(error.code === 1){

        setLocationStatus(
            "Ruxsat berilmagan"
        );

    }else if(error.code === 2){

        setLocationStatus(
            "Joylashuv topilmadi"
        );

    }else if(error.code === 3){

        setLocationStatus(
            "GPS timeout"
        );

    }else{

        setLocationStatus(
            "GPS xatosi"
        );
    }
}


/* ======================================================
   MAP
====================================================== */

function initializeMap(){

    const mapElement =
        document.getElementById(
            "map"
        );


    if(!mapElement){

        console.error(
            "Xato: #map elementi topilmadi."
        );

        return;
    }


    /*
    Leaflet yuklanmagan bo‘lsa
    sahifa butunlay to‘xtab qolmasin.
    */

    if(typeof L === "undefined"){

        console.error(
            "Xato: Leaflet yuklanmagan. " +
            "index.html dagi Leaflet scriptini tekshiring."
        );

        setLocationStatus(
            "Xarita yuklanmadi"
        );

        return;
    }


    if(map){

        refreshMapSize();

        return;
    }


    try{

        map =
            L.map(
                mapElement,
                {
                    zoomControl:false,
                    attributionControl:true,
                    preferCanvas:true
                }
            );


        map.setView(
            [41.3111,69.2797],
            12
        );


        L.control.zoom({
            position:"bottomright"
        }).addTo(map);


        /*
        CartoDB o‘rniga oddiy OpenStreetMap.
        Barqarorroq va test uchun ishonchli.
        */

        lightTile =
            L.tileLayer(
                "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png",
                {
                    maxZoom:19,
                    attribution:
                        '&copy; OpenStreetMap contributors'
                }
            );


        lightTile.addTo(map);


        /*
        Tile yuklanmasa ham Console'da aniq
        xabar chiqadi.
        */

        lightTile.on(
            "tileerror",
            function(error){

                console.warn(
                    "Xarita tile xatosi:",
                    error
                );

            }
        );


        map.whenReady(
            function(){

                refreshMapSize();

            }
        );


        setTimeout(
            function(){

                refreshMapSize();

            },
            100
        );


        setTimeout(
            function(){

                refreshMapSize();

            },
            500
        );


        setTimeout(
            function(){

                refreshMapSize();

            },
            1200
        );


        console.log(
            "Leaflet xarita muvaffaqiyatli ishga tushdi."
        );


    }catch(error){

        console.error(
            "Leaflet xarita ishga tushirish xatosi:",
            error
        );


        map = null;


        setLocationStatus(
            "Xarita xatosi"
        );
    }
}


/* ======================================================
   MAP SIZE
====================================================== */

function refreshMapSize(){

    if(!map){
        return;
    }


    try{

        map.invalidateSize({
            animate:false,
            pan:false
        });

    }catch(error){

        console.warn(
            "Map invalidateSize xatosi:",
            error
        );
    }
}


/* ======================================================
   MAP THEME
====================================================== */

function updateMapTheme(){

    /*
    Hozir xarita uchun bitta ishonchli
    OpenStreetMap layer ishlatilmoqda.
    Dark mode saytning o‘zida ishlaydi.
    */

    if(!map){
        return;
    }


    refreshMapSize();
}


/* ======================================================
   OWN MARKER
====================================================== */

function updateOwnMarker(
    lat,
    lng,
    accuracy
){

    if(!map){
        return;
    }


    const icon =
        createMarkerIcon(
            true
        );


    let marker =
        markers.get("me");


    if(!marker){

        marker =
            L.marker(
                [lat,lng],
                {
                    icon:icon,
                    zIndexOffset:1000
                }
            )
            .addTo(map);


        marker.bindPopup(
            "<strong>Mening joylashuvim</strong><br>" +
            "Siz shu yerdasiz."
        );


        markers.set(
            "me",
            marker
        );

    }else{

        marker.setLatLng(
            [lat,lng]
        );

        marker.setIcon(
            icon
        );
    }


    let circle =
        accuracyCircles.get("me");


    if(!circle){

        circle =
            L.circle(
                [lat,lng],
                {
                    radius:Math.max(
                        accuracy || 20,
                        10
                    ),
                    color:"#18c96b",
                    fillColor:"#18c96b",
                    fillOpacity:.10,
                    weight:1
                }
            )
            .addTo(map);


        accuracyCircles.set(
            "me",
            circle
        );

    }else{

        circle.setLatLng(
            [lat,lng]
        );

        circle.setRadius(
            Math.max(
                accuracy || 20,
                10
            )
        );
    }
}


/* ======================================================
   USERS
====================================================== */

function renderUsers(users){

    if(!Array.isArray(users)){
        return;
    }


    if(memberCount){

        memberCount.textContent =
            String(
                users.length
            );

    }


    renderMemberList(
        users
    );


    renderUserMarkers(
        users
    );
}


function renderUserMarkers(users){

    if(!map){
        return;
    }


    const activeIds =
        new Set(["me"]);


    users.forEach(
        function(user){

            if(
                !user ||
                !user.id ||
                !Number.isFinite(
                    Number(user.lat)
                ) ||
                !Number.isFinite(
                    Number(user.lng)
                )
            ){

                return;
            }


            const isMe =
                user.id === myUserId;


            const markerId =
                isMe
                    ? "me"
                    : user.id;


            activeIds.add(
                markerId
            );


            const lat =
                Number(user.lat);


            const lng =
                Number(user.lng);


            const accuracy =
                Number(
                    user.accuracy || 0
                );


            if(isMe){

                updateOwnMarker(
                    lat,
                    lng,
                    accuracy
                );

                return;
            }


            const icon =
                createMarkerIcon(
                    false
                );


            let marker =
                markers.get(
                    markerId
                );


            if(!marker){

                marker =
                    L.marker(
                        [lat,lng],
                        {
                            icon:icon
                        }
                    )
                    .addTo(map);


                marker.bindPopup(
                    createPopupContent(
                        user
                    )
                );


                markers.set(
                    markerId,
                    marker
                );

            }else{

                marker.setLatLng(
                    [lat,lng]
                );

                marker.setIcon(
                    icon
                );

                marker.setPopupContent(
                    createPopupContent(
                        user
                    )
                );
            }


            let circle =
                accuracyCircles.get(
                    markerId
                );


            if(!circle){

                circle =
                    L.circle(
                        [lat,lng],
                        {
                            radius:Math.max(
                                accuracy || 20,
                                10
                            ),
                            color:"#4785ff",
                            fillColor:"#4785ff",
                            fillOpacity:.08,
                            weight:1
                        }
                    )
                    .addTo(map);


                accuracyCircles.set(
                    markerId,
                    circle
                );

            }else{

                circle.setLatLng(
                    [lat,lng]
                );

                circle.setRadius(
                    Math.max(
                        accuracy || 20,
                        10
                    )
                );
            }

        }
    );


    /*
    Eski markerlarni tozalaymiz.
    */

    for(
        const [id,marker]
        of markers.entries()
    ){

        if(
            id !== "me" &&
            !activeIds.has(id)
        ){

            map.removeLayer(
                marker
            );

            markers.delete(
                id
            );


            const circle =
                accuracyCircles.get(
                    id
                );


            if(circle){

                map.removeLayer(
                    circle
                );

                accuracyCircles.delete(
                    id
                );
            }
        }
    }
}


/* ======================================================
   MARKER ICON
====================================================== */

function createMarkerIcon(isMe){

    if(typeof L === "undefined"){
        return null;
    }


    return L.divIcon({

        className:"custom-gps-icon",

        html:
            '<div class="gps-marker ' +
            (
                isMe
                    ? "me"
                    : "other"
            ) +
            '">' +

                '<div class="gps-marker-dot"></div>' +

            '</div>',

        iconSize:[34,34],

        iconAnchor:[17,17],

        popupAnchor:[0,-18]

    });
}


/* ======================================================
   POPUP
====================================================== */

function createPopupContent(user){

    const name =
        escapeHtml(
            user.name ||
            "Foydalanuvchi"
        );


    const accuracy =
        Number(
            user.accuracy || 0
        );


    return (
        '<div style="min-width:130px">' +

            '<div style="' +
            'font-weight:800;' +
            'font-size:13px;' +
            'margin-bottom:5px;' +
            '">' +

                name +

            '</div>' +

            '<div style="' +
            'font-size:10px;' +
            'color:#718079;' +
            '">' +

                (
                    accuracy > 0
                        ? "Aniqlik: ± " +
                          Math.round(accuracy) +
                          " m"
                        : "GPS faol"
                ) +

            '</div>' +

        '</div>'
    );
}


/* ======================================================
   MEMBERS LIST
====================================================== */

function renderMemberList(users){

    if(!membersList){
        return;
    }


    if(!users.length){

        membersList.innerHTML =
            '<div class="empty-members">' +
                "A'zolar kutilmoqda..." +
            "</div>";

        return;
    }


    membersList.innerHTML = "";


    users.forEach(
        function(user){

            if(!user){
                return;
            }


            const isMe =
                user.id === myUserId;


            const initial =
                String(
                    user.name ||
                    "F"
                )
                .trim()
                .charAt(0)
                .toUpperCase();


            let distanceText =
                "Joylashuv kutilmoqda";


            if(
                currentPosition &&
                Number.isFinite(
                    Number(user.lat)
                ) &&
                Number.isFinite(
                    Number(user.lng)
                )
            ){

                if(isMe){

                    distanceText =
                        "Sizning joylashuvingiz";

                }else{

                    const distance =
                        calculateDistance(
                            currentPosition.lat,
                            currentPosition.lng,
                            Number(user.lat),
                            Number(user.lng)
                        );


                    distanceText =
                        formatDistance(
                            distance
                        );
                }
            }


            const member =
                document.createElement(
                    "div"
                );


            member.className =
                "member";


            member.innerHTML =
                '<div class="member-avatar">' +
                    escapeHtml(initial) +
                '</div>' +

                '<div class="member-info">' +

                    '<div class="member-name">' +

                        escapeHtml(
                            user.name ||
                            "Foydalanuvchi"
                        ) +

                        (
                            isMe
                                ? '<span class="you-badge">SIZ</span>'
                                : ""
                        ) +

                    '</div>' +

                    '<div class="member-distance">' +
                        escapeHtml(
                            distanceText
                        ) +
                    '</div>' +

                '</div>' +

                '<div class="member-status ' +
                    (
                        user.online
                            ? "online"
                            : ""
                    ) +
                '"></div>';


            membersList.appendChild(
                member
            );

        }
    );
}


/* ======================================================
   DISTANCE
====================================================== */

function calculateDistance(
    lat1,
    lng1,
    lat2,
    lng2
){

    const R = 6371000;


    const p1 =
        lat1 *
        Math.PI /
        180;


    const p2 =
        lat2 *
        Math.PI /
        180;


    const dp =
        (lat2 - lat1) *
        Math.PI /
        180;


    const dl =
        (lng2 - lng1) *
        Math.PI /
        180;


    const a =
        Math.sin(dp / 2) *
        Math.sin(dp / 2) +

        Math.cos(p1) *
        Math.cos(p2) *

        Math.sin(dl / 2) *
        Math.sin(dl / 2);


    const c =
        2 *
        Math.atan2(
            Math.sqrt(a),
            Math.sqrt(1 - a)
        );


    return R * c;
}


function formatDistance(meters){

    if(meters < 1000){

        return (
            Math.round(meters) +
            " m uzoqlikda"
        );
    }


    return (
        (meters / 1000)
            .toFixed(1) +
        " km uzoqlikda"
    );
}


/* ======================================================
   MAP CONTROLS
====================================================== */

function moveToMyLocation(){

    if(!map){
        return;
    }


    if(currentPosition){

        map.flyTo(
            [
                currentPosition.lat,
                currentPosition.lng
            ],
            17,
            {
                duration:1.2
            }
        );

        return;
    }


    if(!navigator.geolocation){

        setLocationStatus(
            "GPS mavjud emas"
        );

        return;
    }


    setLocationStatus(
        "Joylashuv olinmoqda..."
    );


    navigator.geolocation.getCurrentPosition(

        function(position){

            handlePosition(
                position
            );


            if(currentPosition){

                map.flyTo(
                    [
                        currentPosition.lat,
                        currentPosition.lng
                    ],
                    17,
                    {
                        duration:1.2
                    }
                );
            }

        },

        handleLocationError,

        {
            enableHighAccuracy:true,
            timeout:15000,
            maximumAge:0
        }
    );
}


function fitGroupOnMap(){

    if(!map){
        return;
    }


    const points = [];


    if(currentPosition){

        points.push([
            currentPosition.lat,
            currentPosition.lng
        ]);

    }


    lastUsers.forEach(
        function(user){

            if(
                user &&
                Number.isFinite(
                    Number(user.lat)
                ) &&
                Number.isFinite(
                    Number(user.lng)
                )
            ){

                points.push([
                    Number(user.lat),
                    Number(user.lng)
                ]);

            }
        }
    );


    if(points.length === 0){

        map.flyTo(
            [41.3111,69.2797],
            12,
            {
                duration:1
            }
        );

        return;
    }


    if(points.length === 1){

        map.flyTo(
            points[0],
            16,
            {
                duration:1
            }
        );

        return;
    }


    const bounds =
        L.latLngBounds(
            points
        );


    map.fitBounds(
        bounds,
        {
            padding:[60,60],
            maxZoom:16,
            animate:true,
            duration:1
        }
    );
}


/* ======================================================
   COPY ROOM
====================================================== */

async function copyRoomCode(){

    if(!currentRoom){
        return;
    }


    try{

        if(
            navigator.clipboard &&
            window.isSecureContext
        ){

            await navigator.clipboard.writeText(
                currentRoom
            );

        }else{

            throw new Error(
                "Clipboard API mavjud emas."
            );
        }

    }catch(error){

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


        try{
            document.execCommand(
                "copy"
            );
        }catch(e){}


        textarea.remove();
    }


    if(copyRoomText){

        const oldText =
            copyRoomText.textContent;


        copyRoomText.textContent =
            "Nusxalandi ✓";


        setTimeout(
            function(){

                copyRoomText.textContent =
                    oldText;

            },
            1600
        );
    }
}


/* ======================================================
   THEME
====================================================== */

function loadTheme(){

    const savedTheme =
        localStorage.getItem(
            STORAGE_THEME
        );


    if(savedTheme === "dark"){

        document.body.classList.add(
            "dark"
        );

    }else{

        document.body.classList.remove(
            "dark"
        );
    }


    updateThemeIcon();
}


function toggleTheme(){

    document.body.classList.toggle(
        "dark"
    );


    const dark =
        document.body.classList.contains(
            "dark"
        );


    localStorage.setItem(
        STORAGE_THEME,
        dark
            ? "dark"
            : "light"
    );


    updateThemeIcon();

    updateMapTheme();
}


function updateThemeIcon(){

    if(!themeIcon){
        return;
    }


    themeIcon.textContent =
        document.body.classList.contains(
            "dark"
        )
            ? "☀"
            : "☾";
}


/* ======================================================
   UI
====================================================== */

function updateConnectionUI(
    online,
    text
){

    if(!connectionPill){
        return;
    }


    connectionPill.classList.toggle(
        "online",
        online
    );


    connectionPill.classList.toggle(
        "offline",
        !online
    );


    if(connectionText){

        connectionText.textContent =
            text;
    }
}


function setConnectionStatus(text){

    if(connectionStatus){

        connectionStatus.textContent =
            text;

    }
}


function setLocationStatus(text){

    if(locationStatus){

        locationStatus.textContent =
            text;

    }
}


function showError(
    message,
    element
){

    if(!element){
        return;
    }


    element.textContent =
        message;


    element.classList.add(
        "show"
    );


    setTimeout(
        function(){

            element.classList.remove(
                "show"
            );

        },
        5000
    );
}


function clearErrors(){

    if(setupError){

        setupError.classList.remove(
            "show"
        );

    }


    if(roomError){

        roomError.classList.remove(
            "show"
        );

    }
}


function setButtonLoading(
    button,
    loading,
    text
){

    if(!button){
        return;
    }


    button.disabled =
        loading;


    button.style.opacity =
        loading
            ? ".7"
            : "1";


    const span =
        button.querySelector(
            "span:nth-child(2)"
        );


    if(span){

        span.textContent =
            text;

    }
}


/* ======================================================
   SERVER ERROR
====================================================== */

function handleServerError(message){

    console.error(
        "SERVER ERROR:",
        message
    );


    const normalized =
        String(
            message || ""
        )
        .toLowerCase();


    if(
        normalized.includes(
            "bunday guruh topilmadi"
        ) ||
        normalized.includes(
            "saqlangan guruh topilmadi"
        )
    ){

        localStorage.removeItem(
            STORAGE_ROOM
        );


        currentRoom = "";


        showSetup();


        showError(
            "Saqlangan guruh topilmadi. Yangi guruh yarating yoki yangi guruh kodini kiriting.",
            setupError
        );


        return;
    }


    if(
        !roomCard ||
        roomCard.classList.contains(
            "hidden"
        )
    ){

        showError(
            message,
            setupError
        );

    }else{

        showError(
            message,
            roomError
        );
    }
}


/* ======================================================
   SHOW SETUP
====================================================== */

function showSetup(){

    stopLocationSharing();

    clearMarkers();

    hasCenteredOnOwnLocation = false;


    if(roomCard){

        roomCard.classList.add(
            "hidden"
        );
    }


    if(setupCard){

        setupCard.classList.remove(
            "hidden"
        );
    }


    if(nameInput){

        const savedName =
            localStorage.getItem(
                STORAGE_NAME
            ) || "";


        nameInput.value =
            savedName;
    }


    if(map){

        refreshMapSize();
    }
}


/* ======================================================
   CLEAR MARKERS
====================================================== */

function clearMarkers(){

    if(map){

        for(
            const marker
            of markers.values()
        ){

            try{

                map.removeLayer(
                    marker
                );

            }catch(error){}

        }


        for(
            const circle
            of accuracyCircles.values()
        ){

            try{

                map.removeLayer(
                    circle
                );

            }catch(error){}

        }
    }


    markers.clear();

    accuracyCircles.clear();

    currentPosition = null;

    lastUsers = [];
}


/* ======================================================
   SAVE SESSION
====================================================== */

function saveSession(){

    if(currentName){

        localStorage.setItem(
            STORAGE_NAME,
            currentName
        );
    }


    if(currentRoom){

        localStorage.setItem(
            STORAGE_ROOM,
            currentRoom
        );
    }
}


/* ======================================================
   ESCAPE HTML
====================================================== */

function escapeHtml(value){

    return String(value)

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


/* ======================================================
   FINAL LOG
====================================================== */

console.log(
    "Live GPS client ishga tushdi."
);