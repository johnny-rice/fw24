import { CfnOutput, Stack } from "aws-cdk-lib";
import { Queue } from "aws-cdk-lib/aws-sqs";
import { Helper } from "../core/helper";
import { FW24Construct, FW24ConstructOutout, OutputType } from "../interfaces/construct";
import { Fw24 } from "../core/fw24";
import HandlerDescriptor from "../interfaces/handler-descriptor";

import { QueueProps } from "aws-cdk-lib/aws-sqs";
import { QueueLambda } from "./queue-lambda";
import { ILambdaEnvConfig } from "../interfaces/lambda-env";
import { LogDuration, createLogger } from "../logging";
import { DynamoDBConstruct } from "./dynamodb";
import { NodejsFunctionProps } from "aws-cdk-lib/aws-lambda-nodejs";

export interface IQueueConstructConfig {
    queuesDirectory?: string;
    queueProps?: QueueProps;
    env?: ILambdaEnvConfig[];
    functionProps?: NodejsFunctionProps;
}

export class QueueConstruct implements FW24Construct {
    readonly logger = createLogger(QueueConstruct.name);
    readonly fw24: Fw24 = Fw24.getInstance();
    
    name: string = QueueConstruct.name;
    dependencies: string[] = [DynamoDBConstruct.name];
    output!: FW24ConstructOutout;

    mainStack!: Stack;

    // default constructor to initialize the stack configuration
    constructor(private queueConstructConfig: IQueueConstructConfig) {
        this.logger.debug("constructor", queueConstructConfig);
        Helper.hydrateConfig(queueConstructConfig,'SQS');
    }

    // construct method to create the stack
    @LogDuration()
    public async construct() {
        // make the main stack available to the class
        this.mainStack = this.fw24.getStack("main");
        // make the fw24 instance available to the class
        // sets the default queues directory if not defined
        if(this.queueConstructConfig.queuesDirectory === undefined || this.queueConstructConfig.queuesDirectory === ""){
            this.queueConstructConfig.queuesDirectory = "./src/queues";
        }

        // register the queues
        await Helper.registerHandlers(this.queueConstructConfig.queuesDirectory, this.registerQueue);

        if (this.fw24.hasModules()) {
            const modules = this.fw24.getModules();
            console.log("SQS stack: construct: app has modules ", Array.from(modules.keys()));
            for (const [, module] of modules) {
                const basePath = module.getBasePath();
                const queuesDirectory = module.getQueuesDirectory();
                if(queuesDirectory != ''){
                    console.log("Load queues from module base-path: ", basePath);
                    await Helper.registerQueuesFromModule(module, this.registerQueue);
                }
            }
        } else {
            console.log("SQS stack: construct: app has no modules ");
        }
    }

    private getEnvironmentVariables(queueConstructConfig: IQueueConstructConfig): any {
        const env: any = {};
        for (const envConfig of queueConstructConfig.env || []) {
            const value = this.fw24.get(envConfig.name, envConfig.prefix || '');
            if (value) {
                env[envConfig.name] = value;
            }
        }
        return env;
    }

    private registerQueue = (queueInfo: HandlerDescriptor) => {
        queueInfo.handlerInstance = new queueInfo.handlerClass();
        this.logger.debug(":::Queue instance: ", queueInfo.fileName, queueInfo.filePath);
        
        const queueName = queueInfo.handlerInstance.queueName;
        const queueConfig = queueInfo.handlerInstance.queueConfig || {};
        const queueProps = {...this.queueConstructConfig.queueProps, ...queueConfig.queueProps};

        this.logger.info(`:::Registering queue ${queueName} from ${queueInfo.filePath}/${queueInfo.fileName}`);

        const queue = new QueueLambda(this.mainStack, queueName + "-queue", {
            queueName: queueName,
            queueProps: queueProps,
            visibilityTimeoutSeconds: queueConfig?.visibilityTimeoutSeconds,
            receiveMessageWaitTimeSeconds: queueConfig?.receiveMessageWaitTimeSeconds,
            retentionPeriodDays: queueConfig?.retentionPeriodDays,
            subscriptions: queueConfig?.subscriptions,            
            lambdaFunctionProps: {
                entry: queueInfo.filePath + "/" + queueInfo.fileName,
                environmentVariables: this.getEnvironmentVariables(queueConfig),
                resourceAccess: queueConfig?.resourceAccess,
                functionTimeout: queueConfig?.functionTimeout,
                functionProps: {...this.queueConstructConfig.functionProps, ...queueConfig?.functionProps},
                logRemovalPolicy: queueConfig?.logRemovalPolicy,
                logRetentionDays: queueConfig?.logRetentionDays,
            }
        }) as Queue;
        this.fw24.setConstructOutput(this, OutputType.QUEUE, queueName, queue);

        // output the api endpoint
        new CfnOutput(this.mainStack, `SQS-${queueName}`, {
            value: queue.queueUrl,
            description: "Queue URL for " + queueName,
        });
    }
}
