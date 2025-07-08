import User from "../../../app/models/user.js";

export type LoginResponse = {
  user: User;
  token: string;
}

export type VerifyTokenResponse = {
  user: User;
}
