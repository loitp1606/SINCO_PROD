using Microsoft.Extensions.Caching.Distributed;
using StackExchange.Redis;

namespace Sinco.Server.Repositories
{
    public interface IRedisService
    {
        Task SetStringAsync(string key, string value, TimeSpan? expiry = null);
        Task<string?> GetStringAsync(string key);
        void RemoveDataAsync(string key);
    }

    public class RedisService : IRedisService
    {
        private readonly IDistributedCache _cache;
        public RedisService(IDistributedCache cache)
        {
            _cache = cache;
        }

        public async Task<string?> GetStringAsync(string key)
        {
            var data = await _cache.GetStringAsync(key);
            return data;
        }

        public async Task SetStringAsync(string key, string value, TimeSpan? expiry = null)
        {
            var options = new DistributedCacheEntryOptions()
            {
                AbsoluteExpirationRelativeToNow = expiry
            };
            await _cache.SetStringAsync(key, value, options);
        }
        public async void RemoveDataAsync(string key)
        {
            await _cache.RemoveAsync(key);
        }
    }
}
