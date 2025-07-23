import { io } from 'socket.io-client';

const SOCKET_URL = `https://${import.meta.env.VITE_API_URL_MY_IP}:5000`; // Use HTTPS and correct IP

const socket = io(SOCKET_URL, {
  autoConnect: false,
  transports: ['websocket'], // force websocket for wss
  secure: true,
});

export default socket; 