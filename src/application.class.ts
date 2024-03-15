import { App, Stack } from "aws-cdk-lib";
import { Fw24 } from "./core/fw24";
import { IApplicationConfig } from "./interfaces/config.interface";


export class Application {
    private _fw24: Fw24;

    constructor(private config: IApplicationConfig) {
        console.log("Initializing fw24 infrastructure...");

        // initialize the Fw24 object
        this._fw24 = new Fw24(config);

        // initialize the main stack
        const app = new App();
        const mainStack = new Stack(app, config.name + "-stack")

        // store the main stack in the framework scope
        this._fw24.addStack("main", mainStack);
    }

    public use(stack: any): Application {
        stack.construct(this._fw24);
        return this;
    }
}
