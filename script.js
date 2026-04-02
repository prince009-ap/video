let localStream;
let peerConnection;
let activeRoomId = '';
let isMuted = false;
let useFrontCamera = true;
let callActive = false;
let deferredInstallPrompt = null;
let isCreator = false;

const configuration = {
    iceServers: [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:stun1.l.google.com:19302' }
    ]
};

const phoneInput = document.getElementById('phoneNumber');
const callSection = document.getElementById('callSection');
const localVideo = document.getElementById('localVideo');
const remoteVideo = document.getElementById('remoteVideo');
const statusText = document.getElementById('status');
const shareLink = document.getElementById('shareLink');
const createButton = document.getElementById('createCall');
const joinButton = document.getElementById('joinCall');
const copyButton = document.getElementById('copyLink');
const shareButton = document.getElementById('shareButton');
const installButton = document.getElementById('installApp');
const muteButton = document.getElementById('muteBtn');
const switchCameraButton = document.getElementById('toggleCamera');
const endCallButton = document.getElementById('endCall');
const socket = typeof window.io === 'function' ? window.io() : null;

createButton.addEventListener('click', () => startCallFlow(true));
joinButton.addEventListener('click', () => startCallFlow(false));
copyButton.addEventListener('click', copyLink);
shareButton.addEventListener('click', shareInvite);
installButton.addEventListener('click', installApp);
muteButton.addEventListener('click', toggleMute);
switchCameraButton.addEventListener('click', switchCamera);
endCallButton.addEventListener('click', endCall);

registerServiceWorker();

if (!socket) {
    statusText.textContent = 'Server script load nahi hua. App ko deployed URL ya local server se kholo.';
    createButton.disabled = true;
    joinButton.disabled = true;
}

if (socket) {
socket.on('connect', () => {
    statusText.textContent = 'Connected. Room ID likho ya Create karke link share karo.';
    createButton.disabled = false;
    joinButton.disabled = false;
});

socket.on('connect_error', () => {
    statusText.textContent = 'Server reachable nahi hai. Same domain par deploy karo ya local server start karo.';
});

socket.on('disconnect', () => {
    statusText.textContent = 'Server disconnected. Refresh after starting the server again.';
});

socket.on('room-joined', async ({ roomId, participantCount, isCreator: creatorStatus }) => {
    activeRoomId = roomId;
    isCreator = creatorStatus || false;
    statusText.textContent = participantCount > 1 ? 'Peer connected. Starting call...' : 'Waiting for another person to join...';

    if (participantCount > 1) {
        await createOffer();
    }
});

socket.on('peer-joined', async () => {
    statusText.textContent = 'Peer joined. Preparing connection...';
});

socket.on('offer', async ({ offer }) => {
    await ensurePeerConnection();
    await peerConnection.setRemoteDescription(offer);
    const answer = await peerConnection.createAnswer();
    await peerConnection.setLocalDescription(answer);
    socket.emit('answer', { roomId: activeRoomId, answer });
    statusText.textContent = 'Answer sent. Connecting...';
});

socket.on('answer', async ({ answer }) => {
    if (!peerConnection) {
        return;
    }

    await peerConnection.setRemoteDescription(answer);
    statusText.textContent = 'Call connected.';
});

socket.on('ice-candidate', async ({ candidate }) => {
    if (!peerConnection || !candidate) {
        return;
    }

    try {
        await peerConnection.addIceCandidate(candidate);
    } catch (error) {
        console.error('Error adding ice candidate:', error);
    }
});

socket.on('call-ended', () => {
    if (isCreator) {
        // Creator: hide remote video container, keep local video
        statusText.textContent = 'Call ended.';
        // Hide the "Other Person" video container
        const remoteVideoContainer = document.querySelector('.video-container:nth-child(2)');
        if (remoteVideoContainer) {
            remoteVideoContainer.style.display = 'none';
        }
        
        // Close peer connection but keep local stream
        if (peerConnection) {
            peerConnection.ontrack = null;
            peerConnection.onicecandidate = null;
            peerConnection.onconnectionstatechange = null;
            peerConnection.close();
            peerConnection = null;
        }
        callActive = false;
    } else {
        // Joiner: full cleanup
        cleanupCall('Other user ended the call.');
    }
});

socket.on('fake-call-ended', () => {
    // Sirf UI change karo, connection mat tod
    statusText.textContent = 'Call ended.';
    
    // Show overlay or message
    alert('Call ended');
    
    // Apna UI hide kar
    callSection.hidden = true;
    
    // ❗IMPORTANT: cleanupCall() mat call karna
});
}

window.addEventListener('load', async () => {
    const roomId = new URLSearchParams(window.location.search).get('room');
    if (!roomId) {
        return;
    }

    phoneInput.value = roomId;
    await startCallFlow(false, roomId);
});

window.addEventListener('beforeinstallprompt', (event) => {
    event.preventDefault();
    deferredInstallPrompt = event;
    installButton.hidden = false;
    statusText.textContent = 'App install kar sakte ho. Install App button use karo.';
});

window.addEventListener('appinstalled', () => {
    deferredInstallPrompt = null;
    installButton.hidden = true;
    statusText.textContent = 'App install ho gaya.';
});

async function startCallFlow(isCreator, presetRoomId) {
    if (!socket || !socket.connected) {
        statusText.textContent = 'Server connect nahi hua. App ko active server/domain se kholo.';
        return;
    }

    const rawValue = presetRoomId || phoneInput.value.trim() || generateRoomId();
    const roomId = sanitizeRoomId(rawValue);

    if (!roomId) {
        alert('Please enter a valid phone number or room id.');
        return;
    }

    phoneInput.value = roomId;
    activeRoomId = roomId;
    statusText.textContent = 'Starting camera...';

    try {
        await startLocalStream();
        await ensurePeerConnection();
        callActive = true;
        callSection.hidden = false;

        const inviteUrl = `${window.location.origin}/?room=${encodeURIComponent(roomId)}`;
        shareLink.textContent = inviteUrl;

        socket.emit('join-room', roomId);
        statusText.textContent = isCreator ? 'Room created. Link share karo.' : 'Joining room...';
    } catch (error) {
        console.error(error);
        statusText.textContent = getMediaErrorMessage(error);
    }
}

function sanitizeRoomId(value) {
    return value.replace(/[^a-zA-Z0-9_-]/g, '');
}

function generateRoomId() {
    return `room-${Math.random().toString(36).slice(2, 10)}`;
}

async function startLocalStream() {
    if (localStream) {
        return;
    }

    localStream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: useFrontCamera ? 'user' : 'environment' },
        audio: true
    });
    localVideo.srcObject = localStream;
}

async function ensurePeerConnection() {
    if (peerConnection) {
        return;
    }

    peerConnection = new RTCPeerConnection(configuration);

    if (localStream) {
        console.log('Adding local stream to peer connection');
        localStream.getTracks().forEach((track) => {
            console.log('Adding track:', track.kind);
            peerConnection.addTrack(track, localStream);
        });
    } else {
        console.log('No local stream available');
    }

    peerConnection.ontrack = (event) => {
        console.log('Remote track received:', event.streams[0]);
        if (event.streams[0]) {
            remoteVideo.srcObject = event.streams[0];
            statusText.textContent = 'Video connected.';
        } else {
            console.log('No remote stream received');
        }
    };

    peerConnection.onicecandidate = (event) => {
        if (!event.candidate) {
            return;
        }

        socket.emit('ice-candidate', {
            roomId: activeRoomId,
            candidate: event.candidate
        });
    };

    peerConnection.onconnectionstatechange = () => {
        if (!peerConnection) {
            return;
        }

        console.log('Connection state:', peerConnection.connectionState);
        if (peerConnection.connectionState === 'connected') {
            statusText.textContent = 'Call is live.';
        }

        // Don't auto-cleanup on disconnect - let socket events handle it
        // This prevents premature cleanup when other user ends call
    };
}

async function createOffer() {
    await ensurePeerConnection();
    const offer = await peerConnection.createOffer();
    await peerConnection.setLocalDescription(offer);
    socket.emit('offer', { roomId: activeRoomId, offer });
    statusText.textContent = 'Offer sent. Waiting for answer...';
}

async function switchCamera() {
    if (!localStream) {
        return;
    }

    useFrontCamera = !useFrontCamera;
    const newStream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: useFrontCamera ? 'user' : 'environment' },
        audio: true
    });

    const videoTrack = newStream.getVideoTracks()[0];
    const sender = peerConnection
        ?.getSenders()
        .find((item) => item.track && item.track.kind === 'video');

    if (sender && videoTrack) {
        await sender.replaceTrack(videoTrack);
    }

    localStream.getTracks().forEach((track) => track.stop());
    localStream = newStream;
    localVideo.srcObject = localStream;
    statusText.textContent = 'Camera switched.';
}

function toggleMute() {
    if (!localStream) {
        return;
    }

    isMuted = !isMuted;
    localStream.getAudioTracks().forEach((track) => {
        track.enabled = !isMuted;
    });
    muteButton.textContent = isMuted ? 'Unmute' : 'Mute';
}

async function copyLink() {
    if (!shareLink.textContent) {
        return;
    }

    await navigator.clipboard.writeText(shareLink.textContent);
    statusText.textContent = 'Invite link copied.';
}

async function shareInvite() {
    if (!shareLink.textContent) {
        return;
    }

    if (navigator.share) {
        await navigator.share({
            title: 'Quick Video Call',
            text: 'Join my video call',
            url: shareLink.textContent
        });
        statusText.textContent = 'Invite shared.';
        return;
    }

    await copyLink();
}

async function installApp() {
    if (!deferredInstallPrompt) {
        statusText.textContent = 'Install option tab dikhega jab browser PWA install allow karega.';
        return;
    }

    deferredInstallPrompt.prompt();
    const choice = await deferredInstallPrompt.userChoice;
    deferredInstallPrompt = null;
    installButton.hidden = true;
    statusText.textContent = choice.outcome === 'accepted' ? 'App install request accept ho gayi.' : 'Install cancel ho gaya.';
}

function endCall() {
    if (activeRoomId) {
        socket.emit('end-call', activeRoomId);
    }

    // Apne side pe UI band kar
    statusText.textContent = 'Call ended.';
    
    // Apna UI hide kar
    callSection.hidden = true;

    // ❗IMPORTANT: peerConnection close mat kar
    // ❗IMPORTANT: cleanupCall() mat call karna
}

function cleanupCall(message = 'Call ended.') {
    if (!callActive && !peerConnection && !localStream) {
        statusText.textContent = message;
        return;
    }

    callActive = false;

    if (peerConnection) {
        peerConnection.ontrack = null;
        peerConnection.onicecandidate = null;
        peerConnection.onconnectionstatechange = null;
        
        // ❗ COMMENT OUT: Don't stop tracks for creator
        // peerConnection.getSenders().forEach((sender) => {
        //     try {
        //         if (sender.track) {
        //             sender.track.stop();
        //         }
        //     } catch (error) {
        //         console.error('Error stopping sender track:', error);
        //     }
        // });
        // peerConnection.getReceivers().forEach((receiver) => {
        //     try {
        //         if (receiver.track) {
        //             receiver.track.stop();
        //         }
        //     } catch (error) {
        //         console.error('Error stopping receiver track:', error);
        //     }
        // });
        
        peerConnection.close();
        peerConnection = null;
    }

    // 🔥 CHANGE: Only stop local stream if NOT creator
    if (!isCreator) {
        if (localStream) {
            localStream.getTracks().forEach((track) => track.stop());
        }
        localStream = null;
    }

    if (remoteVideo.srcObject) {
        remoteVideo.srcObject.getTracks?.().forEach((track) => track.stop());
    }

    // 🔥 CHANGE: Don't null creator's local video
    if (!isCreator) {
        localVideo.srcObject = null;
    }
    remoteVideo.srcObject = null;
    callSection.hidden = true;
    activeRoomId = '';
    isMuted = false;
    muteButton.textContent = 'Mute';
    statusText.textContent = message;
}

function getMediaErrorMessage(error) {
    if (!window.isSecureContext && location.hostname !== 'localhost' && location.hostname !== '127.0.0.1') {
        return 'Mobile aur production me camera ke liye HTTPS zaroori hai.';
    }

    if (error?.name === 'NotAllowedError') {
        return 'Camera/mic permission allow karo.';
    }

    if (error?.name === 'NotFoundError') {
        return 'Camera ya microphone device nahi mila.';
    }

    return 'Camera ya microphone start nahi ho paya.';
}

function registerServiceWorker() {
    if (!('serviceWorker' in navigator)) {
        return;
    }

    window.addEventListener('load', async () => {
        try {
            await navigator.serviceWorker.register('/sw.js');
        } catch (error) {
            console.error('Service worker registration failed:', error);
        }
    });
}
