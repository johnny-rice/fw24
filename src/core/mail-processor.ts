import { SQSHandler, SQSEvent, SQSBatchItemFailure, SQSBatchResponse } from 'aws-lambda';
import { SESv2Client, SendEmailCommand, SendEmailCommandInput, TestRenderEmailTemplateCommand } from '@aws-sdk/client-sesv2';
import { DefaultLogger } from '../logging';

export interface IEmailMessage {
    FromEmailAddress: string;
    ToEmailAddress: string;
    Subject?: string;
    Message?: string;
    TemplateName?: string;
    ReplyToEmailAddress?: string;
}

// Initialize SES client
const sesClient = new SESv2Client();

export const handler: SQSHandler = async (event: SQSEvent) => {
    DefaultLogger.debug('Mail Handler Received event:', event);

    const batchItemFailures: SQSBatchItemFailure[] = [];

    for (const record of event.Records) {
        try {
            DefaultLogger.info('Processing message with ID:', record.messageId);

            // Parse message body
            const { emailMessage, templateData } = JSON.parse(record.body) as {emailMessage: IEmailMessage, templateData: any};

            // check if request is for testing template
            if (templateData && templateData['testRenderEmailTemplate']) {
                const command = new TestRenderEmailTemplateCommand({
                    TemplateName: emailMessage.TemplateName,
                    TemplateData: JSON.stringify({...emailMessage, ...templateData}),
                });
                
                const response = await sesClient.send(command);
                DefaultLogger.info('Test render response:', response);
                continue;
            }

            // Construct email parameters
            const mailParams: SendEmailCommandInput = {
                FromEmailAddress: emailMessage.FromEmailAddress,
                Destination: {
                    ToAddresses: [emailMessage.ToEmailAddress],
                },
                Content: {}
            };

            // If a template name is provided, use it
            if (emailMessage.TemplateName) {
                mailParams.Content = {};
                mailParams.Content.Template = {
                    TemplateName: emailMessage.TemplateName, //change to get full template name from fw24
                    TemplateData: JSON.stringify({...emailMessage, ...templateData})
                } 
            }
            // if body and subject are provided, use them
            else if (emailMessage.Message && emailMessage.Subject) {
                mailParams.Content = {};
                mailParams.Content.Simple = {
                    Body: { Text: { Data: emailMessage.Message } },
                    Subject: { Data: emailMessage.Subject },
                }
            } else {
                throw new Error('Invalid message format. Either provide TemplateName or Message and Subject.');
            }

            // if reply to address is provided, use it
            if (emailMessage.ReplyToEmailAddress) {
                mailParams.ReplyToAddresses = [emailMessage.ReplyToEmailAddress];
            }

            DefaultLogger.debug('Sending email with parameters:', mailParams);

            // Send the email
            try {
                await sendEmail(mailParams);
            } catch (error) {
                throw new Error(`Error sending email: ${JSON.stringify(error)}`);
            }
        } catch (error) {
            DefaultLogger.error('Error processing message:', record);
            DefaultLogger.error('Error:', error);
            const batchItemFailure: SQSBatchItemFailure = {
                itemIdentifier: record.messageId
            };
            batchItemFailures.push(batchItemFailure);
        }
    }

    const sqsBatchResponse: SQSBatchResponse = {
        batchItemFailures: batchItemFailures
    };
    DefaultLogger.info('Mail Processing complete.');

    return sqsBatchResponse;
};

async function sendEmail(mailParams: SendEmailCommandInput): Promise<void> {
    const command = new SendEmailCommand(mailParams);
    const result = await sesClient.send(command);
    DefaultLogger.debug('Email sent successfully. Response:', result);
}