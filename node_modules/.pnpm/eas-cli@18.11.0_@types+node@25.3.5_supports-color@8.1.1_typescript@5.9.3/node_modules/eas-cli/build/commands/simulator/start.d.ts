import EasCommand from '../../commandUtils/EasCommand';
export default class SimulatorStart extends EasCommand {
    static hidden: boolean;
    static description: string;
    static flags: {
        'non-interactive': import("@oclif/core/lib/interfaces").BooleanFlag<boolean>;
        platform: import("@oclif/core/lib/interfaces").OptionFlag<"android" | "ios", import("@oclif/core/lib/interfaces").CustomOptions>;
        type: import("@oclif/core/lib/interfaces").OptionFlag<string, import("@oclif/core/lib/interfaces").CustomOptions>;
        'package-version': import("@oclif/core/lib/interfaces").OptionFlag<string | undefined, import("@oclif/core/lib/interfaces").CustomOptions>;
    };
    static contextDefinition: {
        loggedIn: import("../../commandUtils/context/LoggedInContextField").default;
        projectId: import("../../commandUtils/context/ProjectIdContextField").ProjectIdContextField;
    };
    runAsync(): Promise<void>;
}
