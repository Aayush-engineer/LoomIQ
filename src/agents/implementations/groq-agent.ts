import { APIAgent } from '../api-agent';
import { AgentConfig, AgentRequest } from '../../interfaces/agent.interface';
import { AxiosRequestConfig } from 'axios';

export class GroqAgent extends APIAgent {
  private model: string = 'llama-3.1-70b-versatile';
  private temperature: number = 0.7;
  private conversationHistory: Array<{ role: string; content: string }> = [];

  constructor(config: AgentConfig) {
    super(config);
    
    // Set Groq endpoint
    this.endpoint = config.endpoint || 'https://api.groq.com/openai/v1';
    
    // Set model and temperature from metadata
    if (config.metadata?.model) {
      this.model = config.metadata.model;
    }
    if (config.metadata?.temperature) {
      this.temperature = config.metadata.temperature;
    }
  }

  protected getDefaultHeaders(): Record<string, string> {
    return {
      ...super.getDefaultHeaders(),
      'Authorization': `Bearer ${this.apiKey}`,
    };
  }

  protected async validateCredentials(): Promise<void> {
    try {
      // Test API key by fetching models
      await this.httpClient.get('/models');
      this.logger.info('Groq credentials validated successfully');
    } catch (error) {
      this.logger.error('Groq credential validation failed:', error);
      throw new Error('Invalid Groq API key');
    }
  }

  protected buildAPIRequest(request: AgentRequest): AxiosRequestConfig {
    // Build messages array
    const messages: Array<{ role: string; content: string }> = [];

    // Add system message
    const systemPrompt = request.context?.systemPrompt || 
      this.config.systemPrompt ||
      'You are an AI coding assistant integrated into a multi-agent orchestration system.';
    
    messages.push({
      role: 'system',
      content: systemPrompt
    });

    // Add context-specific instructions
    if (request.context) {
      let contextInstruction = '';

      if (request.context.role) {
        contextInstruction += `Your role in this task: ${request.context.role}\n`;
      }

      if (request.context.previousResult) {
        contextInstruction += `\nPrevious work to build upon:\n${JSON.stringify(request.context.previousResult, null, 2)}\n`;
      }

      if (request.context.instruction) {
        contextInstruction += `\n${request.context.instruction}`;
      }

      if (contextInstruction) {
        messages.push({
          role: 'system',
          content: contextInstruction
        });
      }
    }

    // Add conversation history
    messages.push(...this.conversationHistory);

    // Add current user message
    messages.push({
      role: 'user',
      content: request.prompt
    });

    return {
      method: 'POST',
      url: '/chat/completions',
      data: {
        model: this.model,
        messages: messages,
        temperature: this.temperature,
        max_tokens: 8000, // Groq supports higher limits
      }
    };
  }

  protected parseAPIResponse(response: any, request: AgentRequest): any {
    if (!response.choices || response.choices.length === 0) {
      throw new Error('No response choices from Groq');
    }

    const choice = response.choices[0];
    const content = choice.message?.content;

    if (!content) {
      throw new Error('No content in Groq response');
    }

    // Update conversation history (keep last 10 messages)
    this.conversationHistory.push({
      role: 'user',
      content: request.prompt
    });
    this.conversationHistory.push({
      role: 'assistant',
      content: content
    });

    if (this.conversationHistory.length > 10) {
      this.conversationHistory = this.conversationHistory.slice(-10);
    }

    // Calculate cost if usage data is available
    let cost = 0;
    if (response.usage && this.config.cost) {
      const totalTokens = response.usage.total_tokens || 0;
      cost = this.calculateCost(totalTokens);
    }

    // Return in same format as other agents
    return {
      content: content,
      finishReason: choice.finish_reason,
      metadata: {
        model: this.model,
        tokensUsed: response.usage?.total_tokens,
        promptTokens: response.usage?.prompt_tokens,
        completionTokens: response.usage?.completion_tokens,
        cost: cost
      }
    };
  }

  // Public methods to manage the agent
  public setModel(model: string): void {
    this.model = model;
    this.logger.info(`Groq model changed to: ${model}`);
  }

  public setTemperature(temperature: number): void {
    if (temperature < 0 || temperature > 2) {
      throw new Error('Temperature must be between 0 and 2');
    }
    this.temperature = temperature;
    this.logger.info(`Groq temperature changed to: ${temperature}`);
  }

  public getConversationHistory(): Array<{ role: string; content: string }> {
    return [...this.conversationHistory];
  }

  public clearConversationHistory(): void {
    this.conversationHistory = [];
    this.logger.info(`Cleared conversation history for ${this.config.name}`);
  }
}