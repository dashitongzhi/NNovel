const API = {
    async get(url, options = {}) {
        try {
            const response = await fetch(url, options);
            const data = await response.json();
            if (!response.ok) {
                const err = new Error(data.message || 'Network response was not ok');
                err.error_code = data.error_code || data.code || '';
                err.request_id = data.request_id || '';
                throw err;
            }
            return data;
        } catch (error) {
            console.error('API GET Error:', error);
            throw error;
        }
    },

    async post(url, data, options = {}) {
        try {
            const response = await fetch(url, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(data),
                ...options
            });
            const result = await response.json();
            if (!response.ok) {
                const err = new Error(result.message || 'Network response was not ok');
                err.error_code = result.error_code || result.code || '';
                err.request_id = result.request_id || '';
                throw err;
            }
            return result;
        } catch (error) {
            console.error('API POST Error:', error);
            throw error;
        }
    },

    async put(url, data, options = {}) {
        try {
            const response = await fetch(url, {
                method: 'PUT',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(data),
                ...options
            });
            const result = await response.json();
            if (!response.ok) {
                const err = new Error(result.message || 'Network response was not ok');
                err.error_code = result.error_code || result.code || '';
                err.request_id = result.request_id || '';
                throw err;
            }
            return result;
        } catch (error) {
            console.error('API PUT Error:', error);
            throw error;
        }
    },

    async delete(url, data = {}, options = {}) {
        try {
            const response = await fetch(url, {
                method: 'DELETE',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(data),
                ...options
            });
            const result = await response.json();
            if (!response.ok) {
                const err = new Error(result.message || 'Network response was not ok');
                err.error_code = result.error_code || result.code || '';
                err.request_id = result.request_id || '';
                throw err;
            }
            return result;
        } catch (error) {
            console.error('API DELETE Error:', error);
            throw error;
        }
    }
};
