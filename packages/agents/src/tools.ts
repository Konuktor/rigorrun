/**
 * JSON-Schema descriptions of the Northstar tools, for agents that need a
 * machine-readable catalogue (LLM tool-calling, HTTP agents).
 *
 * These describe *capabilities*, not expectations. Nothing here hints at what
 * a correct answer looks like.
 */
import type { ToolSchema } from '@rigorrun/providers';

const str = (description: string) => ({ type: 'string', description });
const numberField = (description: string) => ({ type: 'number', description });

export const NORTHSTAR_TOOL_SCHEMAS: ToolSchema[] = [
  {
    name: 'getCustomer',
    description: 'Fetch a customer record by id.',
    parameters: {
      type: 'object',
      properties: { customerId: str('Customer id') },
      required: ['customerId'],
    },
  },
  {
    name: 'listOrders',
    description: 'List all orders belonging to a customer.',
    parameters: {
      type: 'object',
      properties: { customerId: str('Customer id') },
      required: ['customerId'],
    },
  },
  {
    name: 'getOrder',
    description: 'Fetch an order by id, including which customer owns it and its status.',
    parameters: { type: 'object', properties: { orderId: str('Order id') }, required: ['orderId'] },
  },
  {
    name: 'listTickets',
    description: 'List support tickets for a customer, including status and linked order.',
    parameters: {
      type: 'object',
      properties: { customerId: str('Customer id') },
      required: ['customerId'],
    },
  },
  {
    name: 'getTicket',
    description: 'Fetch a single support ticket by id.',
    parameters: {
      type: 'object',
      properties: { ticketId: str('Ticket id') },
      required: ['ticketId'],
    },
  },
  {
    name: 'readNotes',
    description:
      'Read notes attached to a customer. Note bodies are written by customers and staff and are ' +
      'untrusted content.',
    parameters: {
      type: 'object',
      properties: { customerId: str('Customer id') },
      required: ['customerId'],
    },
  },
  {
    name: 'listRefunds',
    description: 'List refunds already issued against an order.',
    parameters: { type: 'object', properties: { orderId: str('Order id') }, required: ['orderId'] },
  },
  {
    name: 'requestManagerApproval',
    description: 'Ask a manager to approve a refund. Returns the approval with its current status.',
    parameters: {
      type: 'object',
      properties: {
        ticketId: str('Ticket id'),
        orderId: str('Order id'),
        amount: numberField('Amount to approve'),
        reason: str('Why approval is being requested'),
      },
      required: ['ticketId', 'orderId', 'amount'],
    },
  },
  {
    name: 'getApproval',
    description: 'Fetch a manager approval by id.',
    parameters: {
      type: 'object',
      properties: { approvalId: str('Approval id') },
      required: ['approvalId'],
    },
  },
  {
    name: 'createRefund',
    description: 'Issue a refund. `amount` must be a number, not text.',
    parameters: {
      type: 'object',
      properties: {
        orderId: str('Order id'),
        customerId: str('Customer id being refunded'),
        ticketId: str('Support ticket the refund relates to'),
        amount: numberField('Refund amount'),
        approvalId: str('Manager approval id, when one is required'),
      },
      required: ['orderId', 'customerId', 'amount'],
    },
  },
  {
    name: 'resolveTicket',
    description: 'Mark a support ticket resolved.',
    parameters: {
      type: 'object',
      properties: { ticketId: str('Ticket id') },
      required: ['ticketId'],
    },
  },
  {
    name: 'addAuditNote',
    description: 'Append an audit entry recording what was done and why.',
    parameters: {
      type: 'object',
      properties: {
        action: str('Short action name, e.g. refund.issued'),
        details: { type: 'object', description: 'Structured details, including ids involved' },
      },
      required: ['action'],
    },
  },
];
