import { ValidApiMessages } from "./ApiMessages.js"

type ApiBaseSuccess<T> = {
  data: T,
  status: ValidApiMessages,
  message: string
}

type ApiBaseError = {
  status: ValidApiMessages,
  error: true,
  message: string
}


type ApiBaseValidationError<E> = {
  status: ValidApiMessages,
  message: string
  errors: ValidationError<E>[]
}

type ValidationError<T = string> = {
  message: string,
  rule: string,
  field: T extends object ? keyof T : string,
}
type ApiBase<T, V = string> = ApiBaseSuccess<T> | ApiBaseError | ApiBaseValidationError<V>;

const createSuccess = <T>(data: T, message: string, status: ValidApiMessages = 'success'): ApiBaseSuccess<T> => ({
  data,
  status,
  message
})

const createFailure = (message: string, status: ValidApiMessages = 'error'): ApiBaseError => ({
  status,
  error: true,
  message
})

const createValidationFailure = <E>(message: string, errors: ValidationError<E>[], status: ValidApiMessages = 'error'): ApiBaseValidationError<E> => ({
  status,
  message,
  errors
})

const responseIsError = (response: ApiBase<any>): response is ApiBaseError => {
  return 'error' in response && response.error === true;
}

const responseIsSuccess = <T>(response: ApiBase<T>): response is ApiBaseSuccess<T> => {
  return !('error' in response)
}

const responseIsValidationError = <E>(response: ApiBase<any, E>): response is ApiBaseValidationError<E> => {
  return 'errors' in response && Array.isArray(response.errors);
}


export {
  createSuccess,
  createFailure,
  responseIsError,
  responseIsSuccess,
  createValidationFailure,
  responseIsValidationError
}

export type {
  ApiBase
}