import { GoogleGenAI } from "@google/genai";

// This placeholder will be replaced by the Netlify build process.
const apiKey = '%%GEMINI_API_KEY%%';

export const geminiService = {
  generateDescription: async (productName: string): Promise<string> => {
    try {
      if (!apiKey || apiKey === '%%GEMINI_API_KEY%%') {
        console.warn("Gemini API key not found. Using mock response.");
        return `This is a mock description for ${productName}. Please set your API_KEY in Netlify.`;
      }
      const ai = new GoogleGenAI({ apiKey: apiKey });
      const response = await ai.models.generateContent({
        model: 'gemini-2.5-flash',
        contents: `Generate a compelling, short e-commerce product description for: "${productName}". Focus on key benefits and use persuasive language. Maximum 150 characters.`,
      });
      return response.text;
    } catch (error) {
        console.error("Gemini API error:", error);
        throw new Error("Failed to generate description from Gemini API.");
    }
  },
};
