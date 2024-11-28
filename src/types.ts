export enum Role {
    System = 'system',
    User = 'user',
    Assistant = 'assistant',
}

export interface Message {
    role: Role;
    content: string | [];
}

export interface CreateCompletionOptions {
    model: string;
    messages: Message[];
    temperature?: string;
    stream?: boolean;
    cached?: boolean | string;
}