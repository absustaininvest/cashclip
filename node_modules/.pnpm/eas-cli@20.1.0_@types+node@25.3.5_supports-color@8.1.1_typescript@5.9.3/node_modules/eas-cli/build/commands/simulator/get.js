"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const tslib_1 = require("tslib");
const core_1 = require("@oclif/core");
const url_1 = require("../../build/utils/url");
const EasCommand_1 = tslib_1.__importDefault(require("../../commandUtils/EasCommand"));
const flags_1 = require("../../commandUtils/flags");
const generated_1 = require("../../graphql/generated");
const DeviceRunSessionQuery_1 = require("../../graphql/queries/DeviceRunSessionQuery");
const log_1 = tslib_1.__importStar(require("../../log"));
const ora_1 = require("../../ora");
const env_1 = require("../../simulator/env");
const utils_1 = require("../../simulator/utils");
const json_1 = require("../../utils/json");
class SimulatorGet extends EasCommand_1.default {
    static hidden = true;
    static description = '[EXPERIMENTAL] get info about a remote simulator session on EAS by its device run session ID';
    static flags = {
        id: core_1.Flags.string({
            description: `Device run session ID. Defaults to ${env_1.SIMULATOR_DOTENV_FILE_NAME}.`,
        }),
        ...flags_1.EasNonInteractiveAndJsonFlags,
    };
    static contextDefinition = {
        ...this.ContextOptions.LoggedIn,
        ...this.ContextOptions.ProjectDir,
    };
    async runAsync() {
        const { flags } = await this.parse(SimulatorGet);
        const { json: jsonFlag, nonInteractive } = (0, flags_1.resolveNonInteractiveAndJsonFlags)(flags);
        if (jsonFlag) {
            (0, json_1.enableJsonOutput)();
        }
        const { projectDir, loggedIn: { graphqlClient }, } = await this.getContextAsync(SimulatorGet, {
            nonInteractive,
        });
        await (0, env_1.loadSimulatorEnvAsync)(projectDir);
        const flagId = flags.id || process.env[env_1.EAS_SIMULATOR_SESSION_ID];
        if (!flagId) {
            throw new Error(`No simulator session ID provided. Pass --id, or run \`eas simulator:start\` first to write ${env_1.SIMULATOR_DOTENV_FILE_NAME}.`);
        }
        const fetchSpinner = (0, ora_1.ora)(`Fetching device run session ${flagId}`).start();
        let session;
        try {
            session = await DeviceRunSessionQuery_1.DeviceRunSessionQuery.byIdAsync(graphqlClient, flagId);
            fetchSpinner.succeed(`Fetched device run session ${session.id}`);
        }
        catch (err) {
            fetchSpinner.fail(`Failed to fetch device run session ${flagId}`);
            throw err;
        }
        const jobRunUrl = session.turtleJobRun
            ? (0, url_1.getBareJobRunUrl)(session.app.ownerAccount.name, session.app.slug, session.turtleJobRun.id)
            : '';
        if (jsonFlag) {
            (0, json_1.printJsonOnlyOutput)({
                id: session.id,
                type: (0, utils_1.deviceRunSessionTypeToFlagValue)(session.type),
                status: session.status,
                jobRunUrl: jobRunUrl || undefined,
                remoteConfig: session.remoteConfig,
            });
            return;
        }
        log_1.default.newLine();
        log_1.default.log(`ID:       ${session.id}`);
        log_1.default.log(`Type:     ${session.type}`);
        log_1.default.log(`Status:   ${session.status}`);
        log_1.default.log(`URL:      ${jobRunUrl ? (0, log_1.link)(jobRunUrl) : ''}`);
        if (session.status === generated_1.DeviceRunSessionStatus.InProgress) {
            log_1.default.newLine();
            if (session.remoteConfig) {
                log_1.default.log((0, utils_1.formatRemoteSessionInstructions)(session.remoteConfig, 'env'));
            }
            else {
                log_1.default.log('⏳ Session is starting up — remote config is not available yet. Re-run this command in a moment.');
            }
        }
    }
}
exports.default = SimulatorGet;
