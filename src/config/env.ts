import { z } from 'zod';
import 'dotenv/config';

// Environment variable schema definitions with defaults
const envSchema = z.object({
    NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
    PORT: z.string().default('3000'),

    // LLM Providers (API Keys & Model Names)
    OPENAI_API_KEY: z.string().optional(),
    OPENAI_MODEL: z.string().optional(),
    OPENAI_MODEL_FAST: z.string().default('gpt-4o-mini'),
    OPENAI_MODEL_SMART: z.string().default('gpt-4o'),

    GEMINI_API_KEY: z.string().optional(),
    GEMINI_MODEL: z.string().optional(),
    GEMINI_MODEL_FAST: z.string().default('gemini-1.5-flash'),
    GEMINI_MODEL_SMART: z.string().default('gemini-1.5-pro'),

    OPENROUTER_API_KEY: z.string().optional(),
    OPENROUTER_MODEL: z.string().optional(),
    OPENROUTER_MODEL_FAST: z.string().default('meta-llama/llama-3.2-3b-instruct:free'),
    OPENROUTER_MODEL_SMART: z.string().default('deepseek/deepseek-r1:free'),

    // Optional external database and remote server endpoints
    DATABASE_URL: z.string().url().optional(),
    FAQ_ENDPOINT_URL: z.string().url().optional(),
});

// Validate process.env against schema using fail-fast principle
const parsedEnv = envSchema.safeParse(process.env);

if (!parsedEnv.success) {
    console.error('❌ HATA: Geçersiz çevre değişkenleri (.env):');
    console.error(parsedEnv.error.format());
    process.exit(1);
}

export const env = parsedEnv.data;