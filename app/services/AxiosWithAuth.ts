import env from "#start/env";
import axios, { AxiosInstance } from "axios";

export default class AxiosWithAuth {
  readonly #axios: AxiosInstance;
  constructor(
    baseUrl: string,
  ) {
    this.#axios = axios.create({
      baseURL: baseUrl,
      headers: {
        'x-api-key': env.get('COORDINATOR_API_KEY'),
        'x-server-id': env.get('COORDINATOR_SERVER_ID'),
      },
    });
    console.log("axios created (base auth)", baseUrl)
  }

  get axios() {
    return this.#axios;
  }

 
  
  get get() {
  return this.#axios.get;
  }

  get post() {
    return this.#axios.post;
  }

  get put() {
    return this.#axios.put;
  }
  get delete() {
    return this.#axios.delete;
  }

}

 
