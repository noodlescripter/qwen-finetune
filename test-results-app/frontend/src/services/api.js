import axios from 'axios';

const API_URL = 'http://localhost:5001/api';

const api = axios.create({
  baseURL: API_URL,
  headers: {
    'Content-Type': 'application/json'
  }
});

// Add auth token to requests
api.interceptors.request.use((config) => {
  const token = localStorage.getItem('token');
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

// Handle auth errors
api.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response?.status === 401) {
      localStorage.removeItem('token');
      localStorage.removeItem('user');
      window.location.href = '/login';
    }
    return Promise.reject(error);
  }
);

// Auth
export const authAPI = {
  register: (data) => api.post('/auth/register', data),
  login: (data) => api.post('/auth/login', data),
  me: () => api.get('/auth/me')
};

// Jobs
export const jobsAPI = {
  getAll: () => api.get('/jobs'),
  getById: (id) => api.get(`/jobs/${id}`),
  create: (data) => api.post('/jobs', data),
  update: (id, data) => api.put(`/jobs/${id}`, data),
  delete: (id) => api.delete(`/jobs/${id}`)
};

// Results
export const resultsAPI = {
  getByExecution: (executionId) => api.get(`/results/execution/${executionId}`),
  getByJob: (jobId, params) => api.get(`/results/job/${jobId}`, { params }),
  getLatestByJob: (jobId) => api.get(`/results/job/${jobId}/latest`),
  getFailuresByJob: (jobId) => api.get(`/results/job/${jobId}/failures`),
  getByFile: (fileName, params) => api.get(`/results/file/${fileName}`, { params }),
  getHistory: (jobId, params) => api.get(`/results/job/${jobId}/history`, { params }),
  getOne: (id) => api.get(`/results/${id}`)
};

// Analysis
export const analysisAPI = {
  analyzeExecution: (executionId) => api.post(`/analysis/execution/${executionId}`),
  analyzeJob: (jobId) => api.post(`/analysis/job/${jobId}`),
  analyzeResult: (id) => api.post(`/analysis/result/${id}`),
  analyzeRaw: (rawText) => api.post('/analysis/raw', { rawText }),
  determineAction: (id) => api.post(`/analysis/determine-action/${id}`),
  getJobSummary: (jobId, regenerate = false) => api.get(`/analysis/job-summary/${jobId}`, { params: { regenerate } }),
  health: () => api.get('/analysis/health')
};

// Public (no auth required)
export const publicAPI = {
  getResults: (params) => api.get('/public/results', { params }),
  analyzeUser: (email) => api.post(`/public/analyze-user/${encodeURIComponent(email)}`),
  analyzeCombined: (email) => api.post(`/public/analyze-combined/${encodeURIComponent(email)}`),
  getJobSummary: (jobId) => api.get(`/public/job-summary/${jobId}`),
  downloadReport: (email) => `${API_URL}/public/report${email ? `?email=${encodeURIComponent(email)}` : ''}`
};

export default api;
