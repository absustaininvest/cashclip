"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.DeviceRunSessionQuery = void 0;
const tslib_1 = require("tslib");
const graphql_tag_1 = tslib_1.__importDefault(require("graphql-tag"));
const client_1 = require("../client");
exports.DeviceRunSessionQuery = {
    async byIdAsync(graphqlClient, deviceRunSessionId) {
        const data = await (0, client_1.withErrorHandlingAsync)(graphqlClient
            .query((0, graphql_tag_1.default) `
            query DeviceRunSessionByIdQuery($deviceRunSessionId: ID!) {
              deviceRunSessions {
                byId(deviceRunSessionId: $deviceRunSessionId) {
                  id
                  status
                  turtleJobRun {
                    id
                    status
                    logFileUrls
                  }
                }
              }
            }
          `, { deviceRunSessionId }, { requestPolicy: 'network-only' })
            .toPromise());
        return data.deviceRunSessions.byId;
    },
};
