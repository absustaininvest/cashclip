import { ExpoGraphqlClient } from '../../commandUtils/context/contextUtils/createGraphqlClient';
import { DeviceRunSessionByIdQuery } from '../generated';
export declare const DeviceRunSessionQuery: {
    byIdAsync(graphqlClient: ExpoGraphqlClient, deviceRunSessionId: string): Promise<DeviceRunSessionByIdQuery["deviceRunSessions"]["byId"]>;
};
