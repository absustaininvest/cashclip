import type { QueryKey, UseMutationOptions, UseMutationResult, UseQueryOptions, UseQueryResult } from "@tanstack/react-query";
import type { AdminGetPaypalStatus200, AdminGetWithdrawalsParams, AdminPayoutWithdrawal200, AdminUpdateWithdrawal200, AdminUpdateWithdrawalBody, AuthCredentials, AuthResponse, BalanceResponse, CompleteSessionRequest, ErrorResponse, GetIntegration200, GetIntegrationsStatus200, GetRevenueAllocation200, GetRevenueMargin200, GetRevenueMetrics200, GetRevenueSources200, GetRevenueTransparency200, GetTransactionsParams, HealthStatus, OffersResponse, ProvidersResponse, SessionCompleteResponse, SessionStartResponse, StartOfferRequest, StartSurveyRequest, SurveysResponse, TransactionsResponse, UserResponse, WithdrawalCreatedResponse, WithdrawalRequest, WithdrawalsResponse } from "./api.schemas";
import { customFetch } from "../custom-fetch";
import type { ErrorType, BodyType } from "../custom-fetch";
type AwaitedInput<T> = PromiseLike<T> | T;
type Awaited<O> = O extends AwaitedInput<infer T> ? T : never;
type SecondParameter<T extends (...args: never) => unknown> = Parameters<T>[1];
/**
 * Returns server health status
 * @summary Health check
 */
export declare const getHealthCheckUrl: () => string;
export declare const healthCheck: (options?: RequestInit) => Promise<HealthStatus>;
export declare const getHealthCheckQueryKey: () => readonly ["/api/healthz"];
export declare const getHealthCheckQueryOptions: <TData = Awaited<ReturnType<typeof healthCheck>>, TError = ErrorType<unknown>>(options?: {
    query?: UseQueryOptions<Awaited<ReturnType<typeof healthCheck>>, TError, TData>;
    request?: SecondParameter<typeof customFetch>;
}) => UseQueryOptions<Awaited<ReturnType<typeof healthCheck>>, TError, TData> & {
    queryKey: QueryKey;
};
export type HealthCheckQueryResult = NonNullable<Awaited<ReturnType<typeof healthCheck>>>;
export type HealthCheckQueryError = ErrorType<unknown>;
/**
 * @summary Health check
 */
export declare function useHealthCheck<TData = Awaited<ReturnType<typeof healthCheck>>, TError = ErrorType<unknown>>(options?: {
    query?: UseQueryOptions<Awaited<ReturnType<typeof healthCheck>>, TError, TData>;
    request?: SecondParameter<typeof customFetch>;
}): UseQueryResult<TData, TError> & {
    queryKey: QueryKey;
};
/**
 * @summary Register a new user
 */
export declare const getRegisterUrl: () => string;
export declare const register: (authCredentials: AuthCredentials, options?: RequestInit) => Promise<AuthResponse>;
export declare const getRegisterMutationOptions: <TError = ErrorType<ErrorResponse>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof register>>, TError, {
        data: BodyType<AuthCredentials>;
    }, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationOptions<Awaited<ReturnType<typeof register>>, TError, {
    data: BodyType<AuthCredentials>;
}, TContext>;
export type RegisterMutationResult = NonNullable<Awaited<ReturnType<typeof register>>>;
export type RegisterMutationBody = BodyType<AuthCredentials>;
export type RegisterMutationError = ErrorType<ErrorResponse>;
/**
 * @summary Register a new user
 */
export declare const useRegister: <TError = ErrorType<ErrorResponse>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof register>>, TError, {
        data: BodyType<AuthCredentials>;
    }, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationResult<Awaited<ReturnType<typeof register>>, TError, {
    data: BodyType<AuthCredentials>;
}, TContext>;
/**
 * @summary Login
 */
export declare const getLoginUrl: () => string;
export declare const login: (authCredentials: AuthCredentials, options?: RequestInit) => Promise<AuthResponse>;
export declare const getLoginMutationOptions: <TError = ErrorType<ErrorResponse>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof login>>, TError, {
        data: BodyType<AuthCredentials>;
    }, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationOptions<Awaited<ReturnType<typeof login>>, TError, {
    data: BodyType<AuthCredentials>;
}, TContext>;
export type LoginMutationResult = NonNullable<Awaited<ReturnType<typeof login>>>;
export type LoginMutationBody = BodyType<AuthCredentials>;
export type LoginMutationError = ErrorType<ErrorResponse>;
/**
 * @summary Login
 */
export declare const useLogin: <TError = ErrorType<ErrorResponse>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof login>>, TError, {
        data: BodyType<AuthCredentials>;
    }, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationResult<Awaited<ReturnType<typeof login>>, TError, {
    data: BodyType<AuthCredentials>;
}, TContext>;
/**
 * @summary Get current user
 */
export declare const getGetMeUrl: () => string;
export declare const getMe: (options?: RequestInit) => Promise<UserResponse>;
export declare const getGetMeQueryKey: () => readonly ["/api/auth/me"];
export declare const getGetMeQueryOptions: <TData = Awaited<ReturnType<typeof getMe>>, TError = ErrorType<ErrorResponse>>(options?: {
    query?: UseQueryOptions<Awaited<ReturnType<typeof getMe>>, TError, TData>;
    request?: SecondParameter<typeof customFetch>;
}) => UseQueryOptions<Awaited<ReturnType<typeof getMe>>, TError, TData> & {
    queryKey: QueryKey;
};
export type GetMeQueryResult = NonNullable<Awaited<ReturnType<typeof getMe>>>;
export type GetMeQueryError = ErrorType<ErrorResponse>;
/**
 * @summary Get current user
 */
export declare function useGetMe<TData = Awaited<ReturnType<typeof getMe>>, TError = ErrorType<ErrorResponse>>(options?: {
    query?: UseQueryOptions<Awaited<ReturnType<typeof getMe>>, TError, TData>;
    request?: SecondParameter<typeof customFetch>;
}): UseQueryResult<TData, TError> & {
    queryKey: QueryKey;
};
/**
 * @summary Get user balance
 */
export declare const getGetBalanceUrl: () => string;
export declare const getBalance: (options?: RequestInit) => Promise<BalanceResponse>;
export declare const getGetBalanceQueryKey: () => readonly ["/api/balance"];
export declare const getGetBalanceQueryOptions: <TData = Awaited<ReturnType<typeof getBalance>>, TError = ErrorType<unknown>>(options?: {
    query?: UseQueryOptions<Awaited<ReturnType<typeof getBalance>>, TError, TData>;
    request?: SecondParameter<typeof customFetch>;
}) => UseQueryOptions<Awaited<ReturnType<typeof getBalance>>, TError, TData> & {
    queryKey: QueryKey;
};
export type GetBalanceQueryResult = NonNullable<Awaited<ReturnType<typeof getBalance>>>;
export type GetBalanceQueryError = ErrorType<unknown>;
/**
 * @summary Get user balance
 */
export declare function useGetBalance<TData = Awaited<ReturnType<typeof getBalance>>, TError = ErrorType<unknown>>(options?: {
    query?: UseQueryOptions<Awaited<ReturnType<typeof getBalance>>, TError, TData>;
    request?: SecondParameter<typeof customFetch>;
}): UseQueryResult<TData, TError> & {
    queryKey: QueryKey;
};
/**
 * @summary Get transaction history
 */
export declare const getGetTransactionsUrl: (params?: GetTransactionsParams) => string;
export declare const getTransactions: (params?: GetTransactionsParams, options?: RequestInit) => Promise<TransactionsResponse>;
export declare const getGetTransactionsQueryKey: (params?: GetTransactionsParams) => readonly ["/api/transactions", ...GetTransactionsParams[]];
export declare const getGetTransactionsQueryOptions: <TData = Awaited<ReturnType<typeof getTransactions>>, TError = ErrorType<unknown>>(params?: GetTransactionsParams, options?: {
    query?: UseQueryOptions<Awaited<ReturnType<typeof getTransactions>>, TError, TData>;
    request?: SecondParameter<typeof customFetch>;
}) => UseQueryOptions<Awaited<ReturnType<typeof getTransactions>>, TError, TData> & {
    queryKey: QueryKey;
};
export type GetTransactionsQueryResult = NonNullable<Awaited<ReturnType<typeof getTransactions>>>;
export type GetTransactionsQueryError = ErrorType<unknown>;
/**
 * @summary Get transaction history
 */
export declare function useGetTransactions<TData = Awaited<ReturnType<typeof getTransactions>>, TError = ErrorType<unknown>>(params?: GetTransactionsParams, options?: {
    query?: UseQueryOptions<Awaited<ReturnType<typeof getTransactions>>, TError, TData>;
    request?: SecondParameter<typeof customFetch>;
}): UseQueryResult<TData, TError> & {
    queryKey: QueryKey;
};
/**
 * @summary Request a withdrawal
 */
export declare const getCreateWithdrawalUrl: () => string;
export declare const createWithdrawal: (withdrawalRequest: WithdrawalRequest, options?: RequestInit) => Promise<WithdrawalCreatedResponse>;
export declare const getCreateWithdrawalMutationOptions: <TError = ErrorType<ErrorResponse>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof createWithdrawal>>, TError, {
        data: BodyType<WithdrawalRequest>;
    }, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationOptions<Awaited<ReturnType<typeof createWithdrawal>>, TError, {
    data: BodyType<WithdrawalRequest>;
}, TContext>;
export type CreateWithdrawalMutationResult = NonNullable<Awaited<ReturnType<typeof createWithdrawal>>>;
export type CreateWithdrawalMutationBody = BodyType<WithdrawalRequest>;
export type CreateWithdrawalMutationError = ErrorType<ErrorResponse>;
/**
 * @summary Request a withdrawal
 */
export declare const useCreateWithdrawal: <TError = ErrorType<ErrorResponse>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof createWithdrawal>>, TError, {
        data: BodyType<WithdrawalRequest>;
    }, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationResult<Awaited<ReturnType<typeof createWithdrawal>>, TError, {
    data: BodyType<WithdrawalRequest>;
}, TContext>;
/**
 * @summary Get user withdrawals
 */
export declare const getGetWithdrawalsUrl: () => string;
export declare const getWithdrawals: (options?: RequestInit) => Promise<WithdrawalsResponse>;
export declare const getGetWithdrawalsQueryKey: () => readonly ["/api/withdrawals"];
export declare const getGetWithdrawalsQueryOptions: <TData = Awaited<ReturnType<typeof getWithdrawals>>, TError = ErrorType<unknown>>(options?: {
    query?: UseQueryOptions<Awaited<ReturnType<typeof getWithdrawals>>, TError, TData>;
    request?: SecondParameter<typeof customFetch>;
}) => UseQueryOptions<Awaited<ReturnType<typeof getWithdrawals>>, TError, TData> & {
    queryKey: QueryKey;
};
export type GetWithdrawalsQueryResult = NonNullable<Awaited<ReturnType<typeof getWithdrawals>>>;
export type GetWithdrawalsQueryError = ErrorType<unknown>;
/**
 * @summary Get user withdrawals
 */
export declare function useGetWithdrawals<TData = Awaited<ReturnType<typeof getWithdrawals>>, TError = ErrorType<unknown>>(options?: {
    query?: UseQueryOptions<Awaited<ReturnType<typeof getWithdrawals>>, TError, TData>;
    request?: SecondParameter<typeof customFetch>;
}): UseQueryResult<TData, TError> & {
    queryKey: QueryKey;
};
/**
 * @summary Get survey providers
 */
export declare const getGetSurveyProvidersUrl: () => string;
export declare const getSurveyProviders: (options?: RequestInit) => Promise<ProvidersResponse>;
export declare const getGetSurveyProvidersQueryKey: () => readonly ["/api/surveys/providers"];
export declare const getGetSurveyProvidersQueryOptions: <TData = Awaited<ReturnType<typeof getSurveyProviders>>, TError = ErrorType<unknown>>(options?: {
    query?: UseQueryOptions<Awaited<ReturnType<typeof getSurveyProviders>>, TError, TData>;
    request?: SecondParameter<typeof customFetch>;
}) => UseQueryOptions<Awaited<ReturnType<typeof getSurveyProviders>>, TError, TData> & {
    queryKey: QueryKey;
};
export type GetSurveyProvidersQueryResult = NonNullable<Awaited<ReturnType<typeof getSurveyProviders>>>;
export type GetSurveyProvidersQueryError = ErrorType<unknown>;
/**
 * @summary Get survey providers
 */
export declare function useGetSurveyProviders<TData = Awaited<ReturnType<typeof getSurveyProviders>>, TError = ErrorType<unknown>>(options?: {
    query?: UseQueryOptions<Awaited<ReturnType<typeof getSurveyProviders>>, TError, TData>;
    request?: SecondParameter<typeof customFetch>;
}): UseQueryResult<TData, TError> & {
    queryKey: QueryKey;
};
/**
 * @summary Get available surveys
 */
export declare const getGetAvailableSurveysUrl: () => string;
export declare const getAvailableSurveys: (options?: RequestInit) => Promise<SurveysResponse>;
export declare const getGetAvailableSurveysQueryKey: () => readonly ["/api/surveys/available"];
export declare const getGetAvailableSurveysQueryOptions: <TData = Awaited<ReturnType<typeof getAvailableSurveys>>, TError = ErrorType<unknown>>(options?: {
    query?: UseQueryOptions<Awaited<ReturnType<typeof getAvailableSurveys>>, TError, TData>;
    request?: SecondParameter<typeof customFetch>;
}) => UseQueryOptions<Awaited<ReturnType<typeof getAvailableSurveys>>, TError, TData> & {
    queryKey: QueryKey;
};
export type GetAvailableSurveysQueryResult = NonNullable<Awaited<ReturnType<typeof getAvailableSurveys>>>;
export type GetAvailableSurveysQueryError = ErrorType<unknown>;
/**
 * @summary Get available surveys
 */
export declare function useGetAvailableSurveys<TData = Awaited<ReturnType<typeof getAvailableSurveys>>, TError = ErrorType<unknown>>(options?: {
    query?: UseQueryOptions<Awaited<ReturnType<typeof getAvailableSurveys>>, TError, TData>;
    request?: SecondParameter<typeof customFetch>;
}): UseQueryResult<TData, TError> & {
    queryKey: QueryKey;
};
/**
 * @summary Start a survey session
 */
export declare const getStartSurveyUrl: () => string;
export declare const startSurvey: (startSurveyRequest: StartSurveyRequest, options?: RequestInit) => Promise<SessionStartResponse>;
export declare const getStartSurveyMutationOptions: <TError = ErrorType<unknown>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof startSurvey>>, TError, {
        data: BodyType<StartSurveyRequest>;
    }, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationOptions<Awaited<ReturnType<typeof startSurvey>>, TError, {
    data: BodyType<StartSurveyRequest>;
}, TContext>;
export type StartSurveyMutationResult = NonNullable<Awaited<ReturnType<typeof startSurvey>>>;
export type StartSurveyMutationBody = BodyType<StartSurveyRequest>;
export type StartSurveyMutationError = ErrorType<unknown>;
/**
 * @summary Start a survey session
 */
export declare const useStartSurvey: <TError = ErrorType<unknown>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof startSurvey>>, TError, {
        data: BodyType<StartSurveyRequest>;
    }, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationResult<Awaited<ReturnType<typeof startSurvey>>, TError, {
    data: BodyType<StartSurveyRequest>;
}, TContext>;
/**
 * @summary Complete a survey and claim reward
 */
export declare const getCompleteSurveyUrl: () => string;
export declare const completeSurvey: (completeSessionRequest: CompleteSessionRequest, options?: RequestInit) => Promise<SessionCompleteResponse>;
export declare const getCompleteSurveyMutationOptions: <TError = ErrorType<unknown>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof completeSurvey>>, TError, {
        data: BodyType<CompleteSessionRequest>;
    }, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationOptions<Awaited<ReturnType<typeof completeSurvey>>, TError, {
    data: BodyType<CompleteSessionRequest>;
}, TContext>;
export type CompleteSurveyMutationResult = NonNullable<Awaited<ReturnType<typeof completeSurvey>>>;
export type CompleteSurveyMutationBody = BodyType<CompleteSessionRequest>;
export type CompleteSurveyMutationError = ErrorType<unknown>;
/**
 * @summary Complete a survey and claim reward
 */
export declare const useCompleteSurvey: <TError = ErrorType<unknown>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof completeSurvey>>, TError, {
        data: BodyType<CompleteSessionRequest>;
    }, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationResult<Awaited<ReturnType<typeof completeSurvey>>, TError, {
    data: BodyType<CompleteSessionRequest>;
}, TContext>;
/**
 * @summary Get offerwall providers
 */
export declare const getGetOfferwallProvidersUrl: () => string;
export declare const getOfferwallProviders: (options?: RequestInit) => Promise<ProvidersResponse>;
export declare const getGetOfferwallProvidersQueryKey: () => readonly ["/api/offerwalls/providers"];
export declare const getGetOfferwallProvidersQueryOptions: <TData = Awaited<ReturnType<typeof getOfferwallProviders>>, TError = ErrorType<unknown>>(options?: {
    query?: UseQueryOptions<Awaited<ReturnType<typeof getOfferwallProviders>>, TError, TData>;
    request?: SecondParameter<typeof customFetch>;
}) => UseQueryOptions<Awaited<ReturnType<typeof getOfferwallProviders>>, TError, TData> & {
    queryKey: QueryKey;
};
export type GetOfferwallProvidersQueryResult = NonNullable<Awaited<ReturnType<typeof getOfferwallProviders>>>;
export type GetOfferwallProvidersQueryError = ErrorType<unknown>;
/**
 * @summary Get offerwall providers
 */
export declare function useGetOfferwallProviders<TData = Awaited<ReturnType<typeof getOfferwallProviders>>, TError = ErrorType<unknown>>(options?: {
    query?: UseQueryOptions<Awaited<ReturnType<typeof getOfferwallProviders>>, TError, TData>;
    request?: SecondParameter<typeof customFetch>;
}): UseQueryResult<TData, TError> & {
    queryKey: QueryKey;
};
/**
 * @summary Get available offers
 */
export declare const getGetAvailableOffersUrl: () => string;
export declare const getAvailableOffers: (options?: RequestInit) => Promise<OffersResponse>;
export declare const getGetAvailableOffersQueryKey: () => readonly ["/api/offerwalls/available"];
export declare const getGetAvailableOffersQueryOptions: <TData = Awaited<ReturnType<typeof getAvailableOffers>>, TError = ErrorType<unknown>>(options?: {
    query?: UseQueryOptions<Awaited<ReturnType<typeof getAvailableOffers>>, TError, TData>;
    request?: SecondParameter<typeof customFetch>;
}) => UseQueryOptions<Awaited<ReturnType<typeof getAvailableOffers>>, TError, TData> & {
    queryKey: QueryKey;
};
export type GetAvailableOffersQueryResult = NonNullable<Awaited<ReturnType<typeof getAvailableOffers>>>;
export type GetAvailableOffersQueryError = ErrorType<unknown>;
/**
 * @summary Get available offers
 */
export declare function useGetAvailableOffers<TData = Awaited<ReturnType<typeof getAvailableOffers>>, TError = ErrorType<unknown>>(options?: {
    query?: UseQueryOptions<Awaited<ReturnType<typeof getAvailableOffers>>, TError, TData>;
    request?: SecondParameter<typeof customFetch>;
}): UseQueryResult<TData, TError> & {
    queryKey: QueryKey;
};
/**
 * @summary Start an offer session
 */
export declare const getStartOfferUrl: () => string;
export declare const startOffer: (startOfferRequest: StartOfferRequest, options?: RequestInit) => Promise<SessionStartResponse>;
export declare const getStartOfferMutationOptions: <TError = ErrorType<unknown>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof startOffer>>, TError, {
        data: BodyType<StartOfferRequest>;
    }, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationOptions<Awaited<ReturnType<typeof startOffer>>, TError, {
    data: BodyType<StartOfferRequest>;
}, TContext>;
export type StartOfferMutationResult = NonNullable<Awaited<ReturnType<typeof startOffer>>>;
export type StartOfferMutationBody = BodyType<StartOfferRequest>;
export type StartOfferMutationError = ErrorType<unknown>;
/**
 * @summary Start an offer session
 */
export declare const useStartOffer: <TError = ErrorType<unknown>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof startOffer>>, TError, {
        data: BodyType<StartOfferRequest>;
    }, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationResult<Awaited<ReturnType<typeof startOffer>>, TError, {
    data: BodyType<StartOfferRequest>;
}, TContext>;
/**
 * @summary Complete an offer and claim reward
 */
export declare const getCompleteOfferUrl: () => string;
export declare const completeOffer: (completeSessionRequest: CompleteSessionRequest, options?: RequestInit) => Promise<SessionCompleteResponse>;
export declare const getCompleteOfferMutationOptions: <TError = ErrorType<unknown>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof completeOffer>>, TError, {
        data: BodyType<CompleteSessionRequest>;
    }, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationOptions<Awaited<ReturnType<typeof completeOffer>>, TError, {
    data: BodyType<CompleteSessionRequest>;
}, TContext>;
export type CompleteOfferMutationResult = NonNullable<Awaited<ReturnType<typeof completeOffer>>>;
export type CompleteOfferMutationBody = BodyType<CompleteSessionRequest>;
export type CompleteOfferMutationError = ErrorType<unknown>;
/**
 * @summary Complete an offer and claim reward
 */
export declare const useCompleteOffer: <TError = ErrorType<unknown>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof completeOffer>>, TError, {
        data: BodyType<CompleteSessionRequest>;
    }, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationResult<Awaited<ReturnType<typeof completeOffer>>, TError, {
    data: BodyType<CompleteSessionRequest>;
}, TContext>;
/**
 * @summary Get revenue sources
 */
export declare const getGetRevenueSourcesUrl: () => string;
export declare const getRevenueSources: (options?: RequestInit) => Promise<GetRevenueSources200>;
export declare const getGetRevenueSourcesQueryKey: () => readonly ["/api/revenue/sources"];
export declare const getGetRevenueSourcesQueryOptions: <TData = Awaited<ReturnType<typeof getRevenueSources>>, TError = ErrorType<unknown>>(options?: {
    query?: UseQueryOptions<Awaited<ReturnType<typeof getRevenueSources>>, TError, TData>;
    request?: SecondParameter<typeof customFetch>;
}) => UseQueryOptions<Awaited<ReturnType<typeof getRevenueSources>>, TError, TData> & {
    queryKey: QueryKey;
};
export type GetRevenueSourcesQueryResult = NonNullable<Awaited<ReturnType<typeof getRevenueSources>>>;
export type GetRevenueSourcesQueryError = ErrorType<unknown>;
/**
 * @summary Get revenue sources
 */
export declare function useGetRevenueSources<TData = Awaited<ReturnType<typeof getRevenueSources>>, TError = ErrorType<unknown>>(options?: {
    query?: UseQueryOptions<Awaited<ReturnType<typeof getRevenueSources>>, TError, TData>;
    request?: SecondParameter<typeof customFetch>;
}): UseQueryResult<TData, TError> & {
    queryKey: QueryKey;
};
/**
 * @summary Get revenue allocation
 */
export declare const getGetRevenueAllocationUrl: () => string;
export declare const getRevenueAllocation: (options?: RequestInit) => Promise<GetRevenueAllocation200>;
export declare const getGetRevenueAllocationQueryKey: () => readonly ["/api/revenue/allocation"];
export declare const getGetRevenueAllocationQueryOptions: <TData = Awaited<ReturnType<typeof getRevenueAllocation>>, TError = ErrorType<unknown>>(options?: {
    query?: UseQueryOptions<Awaited<ReturnType<typeof getRevenueAllocation>>, TError, TData>;
    request?: SecondParameter<typeof customFetch>;
}) => UseQueryOptions<Awaited<ReturnType<typeof getRevenueAllocation>>, TError, TData> & {
    queryKey: QueryKey;
};
export type GetRevenueAllocationQueryResult = NonNullable<Awaited<ReturnType<typeof getRevenueAllocation>>>;
export type GetRevenueAllocationQueryError = ErrorType<unknown>;
/**
 * @summary Get revenue allocation
 */
export declare function useGetRevenueAllocation<TData = Awaited<ReturnType<typeof getRevenueAllocation>>, TError = ErrorType<unknown>>(options?: {
    query?: UseQueryOptions<Awaited<ReturnType<typeof getRevenueAllocation>>, TError, TData>;
    request?: SecondParameter<typeof customFetch>;
}): UseQueryResult<TData, TError> & {
    queryKey: QueryKey;
};
/**
 * @summary Get revenue metrics
 */
export declare const getGetRevenueMetricsUrl: () => string;
export declare const getRevenueMetrics: (options?: RequestInit) => Promise<GetRevenueMetrics200>;
export declare const getGetRevenueMetricsQueryKey: () => readonly ["/api/revenue/metrics"];
export declare const getGetRevenueMetricsQueryOptions: <TData = Awaited<ReturnType<typeof getRevenueMetrics>>, TError = ErrorType<unknown>>(options?: {
    query?: UseQueryOptions<Awaited<ReturnType<typeof getRevenueMetrics>>, TError, TData>;
    request?: SecondParameter<typeof customFetch>;
}) => UseQueryOptions<Awaited<ReturnType<typeof getRevenueMetrics>>, TError, TData> & {
    queryKey: QueryKey;
};
export type GetRevenueMetricsQueryResult = NonNullable<Awaited<ReturnType<typeof getRevenueMetrics>>>;
export type GetRevenueMetricsQueryError = ErrorType<unknown>;
/**
 * @summary Get revenue metrics
 */
export declare function useGetRevenueMetrics<TData = Awaited<ReturnType<typeof getRevenueMetrics>>, TError = ErrorType<unknown>>(options?: {
    query?: UseQueryOptions<Awaited<ReturnType<typeof getRevenueMetrics>>, TError, TData>;
    request?: SecondParameter<typeof customFetch>;
}): UseQueryResult<TData, TError> & {
    queryKey: QueryKey;
};
/**
 * @summary Get revenue transparency info
 */
export declare const getGetRevenueTransparencyUrl: () => string;
export declare const getRevenueTransparency: (options?: RequestInit) => Promise<GetRevenueTransparency200>;
export declare const getGetRevenueTransparencyQueryKey: () => readonly ["/api/revenue/transparency"];
export declare const getGetRevenueTransparencyQueryOptions: <TData = Awaited<ReturnType<typeof getRevenueTransparency>>, TError = ErrorType<unknown>>(options?: {
    query?: UseQueryOptions<Awaited<ReturnType<typeof getRevenueTransparency>>, TError, TData>;
    request?: SecondParameter<typeof customFetch>;
}) => UseQueryOptions<Awaited<ReturnType<typeof getRevenueTransparency>>, TError, TData> & {
    queryKey: QueryKey;
};
export type GetRevenueTransparencyQueryResult = NonNullable<Awaited<ReturnType<typeof getRevenueTransparency>>>;
export type GetRevenueTransparencyQueryError = ErrorType<unknown>;
/**
 * @summary Get revenue transparency info
 */
export declare function useGetRevenueTransparency<TData = Awaited<ReturnType<typeof getRevenueTransparency>>, TError = ErrorType<unknown>>(options?: {
    query?: UseQueryOptions<Awaited<ReturnType<typeof getRevenueTransparency>>, TError, TData>;
    request?: SecondParameter<typeof customFetch>;
}): UseQueryResult<TData, TError> & {
    queryKey: QueryKey;
};
/**
 * @summary Get revenue margin breakdown
 */
export declare const getGetRevenueMarginUrl: () => string;
export declare const getRevenueMargin: (options?: RequestInit) => Promise<GetRevenueMargin200>;
export declare const getGetRevenueMarginQueryKey: () => readonly ["/api/revenue/margin"];
export declare const getGetRevenueMarginQueryOptions: <TData = Awaited<ReturnType<typeof getRevenueMargin>>, TError = ErrorType<unknown>>(options?: {
    query?: UseQueryOptions<Awaited<ReturnType<typeof getRevenueMargin>>, TError, TData>;
    request?: SecondParameter<typeof customFetch>;
}) => UseQueryOptions<Awaited<ReturnType<typeof getRevenueMargin>>, TError, TData> & {
    queryKey: QueryKey;
};
export type GetRevenueMarginQueryResult = NonNullable<Awaited<ReturnType<typeof getRevenueMargin>>>;
export type GetRevenueMarginQueryError = ErrorType<unknown>;
/**
 * @summary Get revenue margin breakdown
 */
export declare function useGetRevenueMargin<TData = Awaited<ReturnType<typeof getRevenueMargin>>, TError = ErrorType<unknown>>(options?: {
    query?: UseQueryOptions<Awaited<ReturnType<typeof getRevenueMargin>>, TError, TData>;
    request?: SecondParameter<typeof customFetch>;
}): UseQueryResult<TData, TError> & {
    queryKey: QueryKey;
};
/**
 * @summary Get integration statuses
 */
export declare const getGetIntegrationsStatusUrl: () => string;
export declare const getIntegrationsStatus: (options?: RequestInit) => Promise<GetIntegrationsStatus200>;
export declare const getGetIntegrationsStatusQueryKey: () => readonly ["/api/integrations/status"];
export declare const getGetIntegrationsStatusQueryOptions: <TData = Awaited<ReturnType<typeof getIntegrationsStatus>>, TError = ErrorType<unknown>>(options?: {
    query?: UseQueryOptions<Awaited<ReturnType<typeof getIntegrationsStatus>>, TError, TData>;
    request?: SecondParameter<typeof customFetch>;
}) => UseQueryOptions<Awaited<ReturnType<typeof getIntegrationsStatus>>, TError, TData> & {
    queryKey: QueryKey;
};
export type GetIntegrationsStatusQueryResult = NonNullable<Awaited<ReturnType<typeof getIntegrationsStatus>>>;
export type GetIntegrationsStatusQueryError = ErrorType<unknown>;
/**
 * @summary Get integration statuses
 */
export declare function useGetIntegrationsStatus<TData = Awaited<ReturnType<typeof getIntegrationsStatus>>, TError = ErrorType<unknown>>(options?: {
    query?: UseQueryOptions<Awaited<ReturnType<typeof getIntegrationsStatus>>, TError, TData>;
    request?: SecondParameter<typeof customFetch>;
}): UseQueryResult<TData, TError> & {
    queryKey: QueryKey;
};
/**
 * @summary Get a specific integration
 */
export declare const getGetIntegrationUrl: (id: string) => string;
export declare const getIntegration: (id: string, options?: RequestInit) => Promise<GetIntegration200>;
export declare const getGetIntegrationQueryKey: (id: string) => readonly [`/api/integrations/${string}`];
export declare const getGetIntegrationQueryOptions: <TData = Awaited<ReturnType<typeof getIntegration>>, TError = ErrorType<ErrorResponse>>(id: string, options?: {
    query?: UseQueryOptions<Awaited<ReturnType<typeof getIntegration>>, TError, TData>;
    request?: SecondParameter<typeof customFetch>;
}) => UseQueryOptions<Awaited<ReturnType<typeof getIntegration>>, TError, TData> & {
    queryKey: QueryKey;
};
export type GetIntegrationQueryResult = NonNullable<Awaited<ReturnType<typeof getIntegration>>>;
export type GetIntegrationQueryError = ErrorType<ErrorResponse>;
/**
 * @summary Get a specific integration
 */
export declare function useGetIntegration<TData = Awaited<ReturnType<typeof getIntegration>>, TError = ErrorType<ErrorResponse>>(id: string, options?: {
    query?: UseQueryOptions<Awaited<ReturnType<typeof getIntegration>>, TError, TData>;
    request?: SecondParameter<typeof customFetch>;
}): UseQueryResult<TData, TError> & {
    queryKey: QueryKey;
};
/**
 * @summary Get all withdrawals (admin)
 */
export declare const getAdminGetWithdrawalsUrl: (params?: AdminGetWithdrawalsParams) => string;
export declare const adminGetWithdrawals: (params?: AdminGetWithdrawalsParams, options?: RequestInit) => Promise<WithdrawalsResponse>;
export declare const getAdminGetWithdrawalsQueryKey: (params?: AdminGetWithdrawalsParams) => readonly ["/api/admin/withdrawals", ...AdminGetWithdrawalsParams[]];
export declare const getAdminGetWithdrawalsQueryOptions: <TData = Awaited<ReturnType<typeof adminGetWithdrawals>>, TError = ErrorType<unknown>>(params?: AdminGetWithdrawalsParams, options?: {
    query?: UseQueryOptions<Awaited<ReturnType<typeof adminGetWithdrawals>>, TError, TData>;
    request?: SecondParameter<typeof customFetch>;
}) => UseQueryOptions<Awaited<ReturnType<typeof adminGetWithdrawals>>, TError, TData> & {
    queryKey: QueryKey;
};
export type AdminGetWithdrawalsQueryResult = NonNullable<Awaited<ReturnType<typeof adminGetWithdrawals>>>;
export type AdminGetWithdrawalsQueryError = ErrorType<unknown>;
/**
 * @summary Get all withdrawals (admin)
 */
export declare function useAdminGetWithdrawals<TData = Awaited<ReturnType<typeof adminGetWithdrawals>>, TError = ErrorType<unknown>>(params?: AdminGetWithdrawalsParams, options?: {
    query?: UseQueryOptions<Awaited<ReturnType<typeof adminGetWithdrawals>>, TError, TData>;
    request?: SecondParameter<typeof customFetch>;
}): UseQueryResult<TData, TError> & {
    queryKey: QueryKey;
};
/**
 * @summary Update withdrawal status (admin)
 */
export declare const getAdminUpdateWithdrawalUrl: (id: string) => string;
export declare const adminUpdateWithdrawal: (id: string, adminUpdateWithdrawalBody: AdminUpdateWithdrawalBody, options?: RequestInit) => Promise<AdminUpdateWithdrawal200>;
export declare const getAdminUpdateWithdrawalMutationOptions: <TError = ErrorType<unknown>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof adminUpdateWithdrawal>>, TError, {
        id: string;
        data: BodyType<AdminUpdateWithdrawalBody>;
    }, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationOptions<Awaited<ReturnType<typeof adminUpdateWithdrawal>>, TError, {
    id: string;
    data: BodyType<AdminUpdateWithdrawalBody>;
}, TContext>;
export type AdminUpdateWithdrawalMutationResult = NonNullable<Awaited<ReturnType<typeof adminUpdateWithdrawal>>>;
export type AdminUpdateWithdrawalMutationBody = BodyType<AdminUpdateWithdrawalBody>;
export type AdminUpdateWithdrawalMutationError = ErrorType<unknown>;
/**
 * @summary Update withdrawal status (admin)
 */
export declare const useAdminUpdateWithdrawal: <TError = ErrorType<unknown>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof adminUpdateWithdrawal>>, TError, {
        id: string;
        data: BodyType<AdminUpdateWithdrawalBody>;
    }, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationResult<Awaited<ReturnType<typeof adminUpdateWithdrawal>>, TError, {
    id: string;
    data: BodyType<AdminUpdateWithdrawalBody>;
}, TContext>;
/**
 * @summary Process PayPal payout (admin)
 */
export declare const getAdminPayoutWithdrawalUrl: (id: string) => string;
export declare const adminPayoutWithdrawal: (id: string, options?: RequestInit) => Promise<AdminPayoutWithdrawal200>;
export declare const getAdminPayoutWithdrawalMutationOptions: <TError = ErrorType<unknown>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof adminPayoutWithdrawal>>, TError, {
        id: string;
    }, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationOptions<Awaited<ReturnType<typeof adminPayoutWithdrawal>>, TError, {
    id: string;
}, TContext>;
export type AdminPayoutWithdrawalMutationResult = NonNullable<Awaited<ReturnType<typeof adminPayoutWithdrawal>>>;
export type AdminPayoutWithdrawalMutationError = ErrorType<unknown>;
/**
 * @summary Process PayPal payout (admin)
 */
export declare const useAdminPayoutWithdrawal: <TError = ErrorType<unknown>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof adminPayoutWithdrawal>>, TError, {
        id: string;
    }, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationResult<Awaited<ReturnType<typeof adminPayoutWithdrawal>>, TError, {
    id: string;
}, TContext>;
/**
 * @summary Get PayPal configuration status (admin)
 */
export declare const getAdminGetPaypalStatusUrl: () => string;
export declare const adminGetPaypalStatus: (options?: RequestInit) => Promise<AdminGetPaypalStatus200>;
export declare const getAdminGetPaypalStatusQueryKey: () => readonly ["/api/admin/paypal-status"];
export declare const getAdminGetPaypalStatusQueryOptions: <TData = Awaited<ReturnType<typeof adminGetPaypalStatus>>, TError = ErrorType<unknown>>(options?: {
    query?: UseQueryOptions<Awaited<ReturnType<typeof adminGetPaypalStatus>>, TError, TData>;
    request?: SecondParameter<typeof customFetch>;
}) => UseQueryOptions<Awaited<ReturnType<typeof adminGetPaypalStatus>>, TError, TData> & {
    queryKey: QueryKey;
};
export type AdminGetPaypalStatusQueryResult = NonNullable<Awaited<ReturnType<typeof adminGetPaypalStatus>>>;
export type AdminGetPaypalStatusQueryError = ErrorType<unknown>;
/**
 * @summary Get PayPal configuration status (admin)
 */
export declare function useAdminGetPaypalStatus<TData = Awaited<ReturnType<typeof adminGetPaypalStatus>>, TError = ErrorType<unknown>>(options?: {
    query?: UseQueryOptions<Awaited<ReturnType<typeof adminGetPaypalStatus>>, TError, TData>;
    request?: SecondParameter<typeof customFetch>;
}): UseQueryResult<TData, TError> & {
    queryKey: QueryKey;
};
export {};
//# sourceMappingURL=api.d.ts.map