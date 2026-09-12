import axios, { InternalAxiosRequestConfig } from "axios";
import { url } from "inspector";
import { Logger } from "winston";
import { LogMessageType } from "../types/enums";
import axiosRetry from "axios-retry";

export function setAxiosInterceptors(logger: Logger): void {
  axios.interceptors.request.use(config => {
    logger.info({
      message: `Request: [${config.method}] ${config.url}`,
      url: constructFullUrl(config),
      method: config.method,
      headers: config.headers,
      type: LogMessageType.REQUEST_SENT
    });
    return config;
  });

  axios.interceptors.response.use(response => {
    logger.info({
      message: `Response: [${response.config.method}] ${response.config.url}`,
      url: constructFullUrl(response.config),
      status: response.status,
      method: response.config.method,
      type: LogMessageType.RESPONSE_RECEIVED,
    });
    return response;
  });

  axiosRetry(axios, {
    retries: 3,
    retryDelay: axiosRetry.exponentialDelay,
    retryCondition: error => error.response?.status === 504,
  });
}

function constructFullUrl(config: InternalAxiosRequestConfig<any>): string {
  const { url, params } = config;
  const queryParams = params ? Object.keys(params).map(key => `${key}=${params[key]}`).join('&') : '';
  return `${url}${queryParams ? `?${queryParams}` : ''}`;
}
