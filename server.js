const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
    cors: { origin: '*' }
});

app.use(cors());
app.use(express.static(__dirname));

const roomCreators = new Map();

io.on('connection', (socket) => {
    console.log('Client connected:', socket.id);

    socket.on('join-room', (roomId) => {
        socket.join(roomId);
        const room = io.sockets.adapter.rooms.get(roomId);
        const participantCount = room ? room.size : 0;

        // Track room creator (first person to join)
        if (!roomCreators.has(roomId)) {
            roomCreators.set(roomId, socket.id);
        }

        const isCreator = roomCreators.get(roomId) === socket.id;
        socket.emit('room-joined', { roomId, participantCount, isCreator });
        socket.to(roomId).emit('peer-joined');
    });

    socket.on('offer', ({ roomId, offer }) => {
        socket.to(roomId).emit('offer', { offer });
    });

    socket.on('answer', ({ roomId, answer }) => {
        socket.to(roomId).emit('answer', { answer });
    });

    socket.on('ice-candidate', ({ roomId, candidate }) => {
        socket.to(roomId).emit('ice-candidate', { candidate });
    });

    socket.on('end-call', (roomId) => {
        const isCreator = roomCreators.get(roomId) === socket.id;
        
        if (isCreator) {
            // If creator ends call, joiner sees fake-call-ended, creator stays in call
            socket.to(roomId).emit('fake-call-ended');
        } else {
            // If joiner ends call, they see fake-call-ended, creator stays in call
            socket.emit('fake-call-ended');
        }
    });

    socket.on('fake-call-ended-notify', (roomId) => {
        // Send fake call ended message to other user
        socket.to(roomId).emit('fake-call-ended');
    });

    socket.on('disconnect', () => {
        console.log('Client disconnected:', socket.id);
        
        // Clean up room creator tracking
        for (const [roomId, creatorId] of roomCreators.entries()) {
            if (creatorId === socket.id) {
                roomCreators.delete(roomId);
                break;
            }
        }
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, '0.0.0.0', () => {
    console.log(`Server running on http://localhost:${PORT}`);
});
