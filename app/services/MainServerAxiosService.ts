import env from "#start/env";
import axios, { AxiosInstance } from "axios";

class MainServerAxiosService {
  readonly #axios: AxiosInstance;
  constructor() {
    this.#axios = axios.create({
      baseURL: env.get('COORDINATOR_URL'),
      headers: {
        'x-api-key': env.get('COORDINATOR_API_KEY'),
        'x-server-id': env.get('COORDINATOR_SERVER_ID'),
      },
    });
    console.log("axios created")
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

export default new MainServerAxiosService();

