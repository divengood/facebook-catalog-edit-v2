import type { Product, ProductSet, Business, Catalog, LoginStatusResponse, AuthResponse } from '../types';

const GRAPH_API_VERSION = 'v19.0';
const BASE_URL = `https://graph.facebook.com/${GRAPH_API_VERSION}`;

declare global {
  interface Window {
    FB: any;
    fbAsyncInit?: () => void;
  }
}

// Module-level promise to ensure the SDK is initialized only once.
let sdkInitializationPromise: Promise<void> | null = null;

const apiCall = async (path: string, method: 'GET' | 'POST' | 'DELETE', token: string, params: Record<string, any> = {}) => {
  const url = new URL(`${BASE_URL}${path}`);
  url.searchParams.append('access_token', token);

  const options: RequestInit = { method };

  if (method === 'GET') {
    Object.entries(params).forEach(([key, value]) => url.searchParams.append(key, value));
  } else {
    options.body = new URLSearchParams(params);
    options.headers = {
      'Content-Type': 'application/x-www-form-urlencoded',
    };
  }
  
  const response = await fetch(url.toString(), options);
  const data = await response.json();

  if (!response.ok) {
    throw new Error(data.error?.message || 'Facebook API request failed');
  }
  return data;
};

export const facebookService = {
  sdkInit: (appId: string): Promise<void> => {
    if (sdkInitializationPromise) {
      return sdkInitializationPromise;
    }
    
    sdkInitializationPromise = new Promise((resolve, reject) => {
      window.fbAsyncInit = function() {
        try {
          window.FB.init({
            appId,
            cookie: true,
            xfbml: true,
            version: GRAPH_API_VERSION
          });
          resolve();
        } catch (error) {
          reject(error);
        }
      };
      
      // Check if the script is already on the page
      if (document.getElementById('facebook-jssdk')) {
        return;
      }

      const script = document.createElement('script');
      script.id = 'facebook-jssdk';
      script.src = "https://connect.facebook.net/en_US/sdk.js";
      script.async = true;
      script.defer = true;
      script.crossOrigin = 'anonymous';
      script.onerror = () => reject(new Error('Facebook SDK script failed to load.'));
      
      document.head.appendChild(script);
    });
    
    return sdkInitializationPromise;
  },

  getLoginStatus: (): Promise<LoginStatusResponse> => {
    return new Promise(resolve => window.FB.getLoginStatus(resolve));
  },

  login: (): Promise<LoginStatusResponse> => {
      return new Promise(resolve => window.FB.login(resolve, { scope: 'catalog_management,business_management,pages_show_list' }));
  },

  logout: (): Promise<void> => {
      return new Promise(resolve => window.FB.logout(resolve));
  },
  
  getBusinesses: (userId: string, token: string): Promise<Business[]> => 
    apiCall(`/${userId}/businesses`, 'GET', token).then(res => res.data),

  getCatalogs: (businessId: string, token: string): Promise<Catalog[]> => 
    apiCall(`/${businessId}/owned_product_catalogs`, 'GET', token, {fields: 'id,name'}).then(res => res.data),

  getProducts: async (catalogId: string, token: string): Promise<Product[]> => {
    const fields = 'id,name,description,brand,url,price,currency,image_url';
    const response = await apiCall(`/${catalogId}/products`, 'GET', token, { fields, limit: 100 });
    // Note: This implementation doesn't handle pagination for catalogs with >100 products.
    return response.data.map((p: any) => ({
        ...p,
        link: p.url,
        price: p.price / 100, // Convert from cents
        image: { url: p.image_url }
    }));
  },

  addProducts: (catalogId: string, token: string, products: Omit<Product, 'id'>[]): Promise<any> => {
    const requests = products.map(p => ({
        method: 'POST',
        retailer_id: `prod_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
        data: {
            name: p.name,
            description: p.description,
            brand: p.brand,
            url: p.link,
            image_url: p.image.url,
            price: p.price * 100, // Price in cents
            currency: p.currency,
            availability: 'in stock'
        },
    }));
    return apiCall(`/${catalogId}/products_batch`, 'POST', token, { requests: JSON.stringify(requests) });
  },

  deleteProducts: (catalogId: string, token: string, productIds: string[]): Promise<{ success: boolean }> => {
    const batch = productIds.map(id => ({
      method: 'DELETE',
      relative_url: id,
    }));
    return apiCall('', 'POST', token, { batch: JSON.stringify(batch) });
  },

  getProductSets: async (catalogId: string, token: string): Promise<ProductSet[]> => {
      const response = await apiCall(`/${catalogId}/product_sets`, 'GET', token, { fields: 'id,name' });
      const setsWithProducts = await Promise.all(response.data.map(async (set: any) => {
          const productsResponse = await apiCall(`/${set.id}/products`, 'GET', token, { fields: 'id' });
          return {
              id: set.id,
              name: set.name,
              product_ids: productsResponse.data.map((p: {id: string}) => p.id)
          };
      }));
      return setsWithProducts;
  },

  createProductSets: (catalogId: string, token: string, sets: {name: string}[]): Promise<any> => {
    const batch = sets.map(s => ({
      method: 'POST',
      relative_url: `${catalogId}/product_sets`,
      body: `name=${encodeURIComponent(s.name)}`,
    }));
    return apiCall('', 'POST', token, { batch: JSON.stringify(batch) });
  },

  deleteProductSets: (catalogId: string, token: string, setIds: string[]): Promise<{ success: boolean }> => {
    const batch = setIds.map(id => ({
      method: 'DELETE',
      relative_url: id,
    }));
    return apiCall('', 'POST', token, { batch: JSON.stringify(batch) });
  },

  updateProductSet: async (setId: string, token: string, productIds: string[]): Promise<void> => {
      // FIX: Argument of type 'unknown' is not assignable to parameter of type 'string'.
      // By explicitly typing `currentProductsResponse`, we ensure that `p` in the subsequent `.map`
      // is correctly inferred as an object with a string `id`, which resolves type issues downstream.
      const currentProductsResponse: { data: { id: string }[] } = await apiCall(`/${setId}/products`, 'GET', token, { fields: 'id', limit: 1000 });
      const currentProductIds = new Set((currentProductsResponse.data || []).map(p => p.id));
      const newProductIds = new Set(productIds);

      const productsToAdd = [...newProductIds].filter(id => !currentProductIds.has(id));
      const productsToRemove = [...currentProductIds].filter(id => !newProductIds.has(id));

      const batch: any[] = [];
      if (productsToAdd.length > 0) {
        batch.push({
          method: 'POST',
          relative_url: `${setId}/products`,
          body: `product_ids=${JSON.stringify(productsToAdd)}`
        });
      }
       if (productsToRemove.length > 0) {
        batch.push({
          method: 'DELETE',
          relative_url: `${setId}/products`,
          body: `product_ids=${JSON.stringify(productsToRemove)}`
        });
      }

      if (batch.length > 0) {
        await apiCall('', 'POST', token, { batch: JSON.stringify(batch) });
      }
  },
};
