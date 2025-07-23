import axios from 'axios';

const API_BASE_URL = `https://${import.meta.env.VITE_API_URL_MY_IP}:5000/api`;

const api = axios.create({
  baseURL: API_BASE_URL,
});

// Attach token to requests if present
api.interceptors.request.use((config) => {
  const token = localStorage.getItem('token');
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

export default api; 