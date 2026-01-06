/**
 * HTTP client utility with retry and timeout support.
 */

export interface RequestConfig {
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH';
  headers?: Record<string, string>;
  body?: unknown;
  timeout?: number;
  retries?: number;
  retryDelay?: number;
}

export interface HttpResponse<T = unknown> {
  data: T;
  status: number;
  headers: Headers;
}

export class HttpError extends Error {
  constructor(
    public status: number,
    public statusText: string,
    public data?: unknown
  ) {
    super(`HTTP Error ${status}: ${statusText}`);
    this.name = 'HttpError';
  }
}

export class HttpClient {
  private baseUrl: string;
  private defaultHeaders: Record<string, string>;
  private defaultTimeout: number;

  constructor(baseUrl: string, options?: { headers?: Record<string, string>; timeout?: number }) {
    this.baseUrl = baseUrl.replace(/\/$/, '');
    this.defaultHeaders = options?.headers ?? { 'Content-Type': 'application/json' };
    this.defaultTimeout = options?.timeout ?? 30000;
  }

  private async sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  private async fetchWithTimeout(url: string, options: RequestInit, timeout: number): Promise<Response> {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeout);

    try {
      const response = await fetch(url, {
        ...options,
        signal: controller.signal,
      });
      return response;
    } finally {
      clearTimeout(timeoutId);
    }
  }

  async request<T>(endpoint: string, config: RequestConfig = {}): Promise<HttpResponse<T>> {
    const {
      method = 'GET',
      headers = {},
      body,
      timeout = this.defaultTimeout,
      retries = 0,
      retryDelay = 1000,
    } = config;

    const url = `${this.baseUrl}${endpoint}`;
    const requestHeaders = { ...this.defaultHeaders, ...headers };

    const options: RequestInit = {
      method,
      headers: requestHeaders,
      body: body ? JSON.stringify(body) : undefined,
    };

    let lastError: Error | null = null;

    for (let attempt = 0; attempt <= retries; attempt++) {
      try {
        const response = await this.fetchWithTimeout(url, options, timeout);

        if (!response.ok) {
          const errorData = await response.json().catch(() => null);
          throw new HttpError(response.status, response.statusText, errorData);
        }

        const data = await response.json() as T;
        return { data, status: response.status, headers: response.headers };
      } catch (error) {
        lastError = error as Error;

        if (attempt < retries) {
          await this.sleep(retryDelay * (attempt + 1));
        }
      }
    }

    throw lastError;
  }

  async get<T>(endpoint: string, config?: Omit<RequestConfig, 'method' | 'body'>): Promise<HttpResponse<T>> {
    return this.request<T>(endpoint, { ...config, method: 'GET' });
  }

  async post<T>(endpoint: string, body?: unknown, config?: Omit<RequestConfig, 'method'>): Promise<HttpResponse<T>> {
    return this.request<T>(endpoint, { ...config, method: 'POST', body });
  }

  async put<T>(endpoint: string, body?: unknown, config?: Omit<RequestConfig, 'method'>): Promise<HttpResponse<T>> {
    return this.request<T>(endpoint, { ...config, method: 'PUT', body });
  }

  async delete<T>(endpoint: string, config?: Omit<RequestConfig, 'method' | 'body'>): Promise<HttpResponse<T>> {
    return this.request<T>(endpoint, { ...config, method: 'DELETE' });
  }
}

export function createHttpClient(baseUrl: string, options?: { headers?: Record<string, string>; timeout?: number }): HttpClient {
  return new HttpClient(baseUrl, options);
}
