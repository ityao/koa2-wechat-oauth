var urllib = require('urllib');
var extend = require('util')._extend;
var querystring = require('querystring');

var AccessToken = function (data) {
  if (!(this instanceof AccessToken)) {
    return new AccessToken(data);
  }
  this.data = data;
};

/*!
 * 检查AccessToken是否有效，检查规则为当前时间和过期时间进行对比
 *
 * Examples:
 * ```
 * token.isValid();
 * ```
 */
AccessToken.prototype.isValid = function () {
  return !!this.data.access_token && (new Date().getTime()) < (this.data.create_at + this.data.expires_in * 1000);
};

/**
 * 根据appid和appsecret创建OAuth接口的构造函数
 * 如需跨进程跨机器进行操作，access token需要进行全局维护
 * 使用使用token的优先级是：
 *
 * 1. 使用当前缓存的token对象
 * 2. 调用开发传入的获取token的异步方法，获得token之后使用（并缓存它）。

 * Examples:
 * ```
 * var OAuth = require('wechat-oauth');
 * var api = new OAuth('appid', 'secret');
 * ```
 * @param {String} appid 在公众平台上申请得到的appid
 * @param {String} appsecret 在公众平台上申请得到的app secret
 * @param {Generator} getToken 用于获取token的方法
 * @param {Generator} saveToken 用于保存token的方法
 */
var OAuth = function (appid, appsecret, getToken, saveToken) {
  this.appid = appid;
  this.appsecret = appsecret;
  // token的获取和存储
  this.store = {};
  this.getToken = getToken || function (openid) {
    return this.store[openid];
  };
  if (!saveToken && process.env.NODE_ENV === 'production') {
    console.warn("Please dont save oauth token into memory under production");
  }
  this.saveToken = saveToken || function (openid, token) {
    this.store[openid] = token;
  };
  this.defaults = {};
};

/**
 * 用于设置urllib的默认options
 *
 * Examples:
 * ```
 * oauth.setOpts({timeout: 15000});
 * ```
 * @param {Object} opts 默认选项
 */
OAuth.prototype.setOpts = function (opts) {
  this.defaults = opts;
};

/*!
 * urllib的封装
 *
 * @param {String} url 路径
 * @param {Object} opts urllib选项
 */
OAuth.prototype.request = async function(url, opts) {
  var options = {};
  extend(options, this.defaults);
  opts || (opts = {});
  for (var key in opts) {
    if (key !== 'headers') {
      options[key] = opts[key];
    } else {
      if (opts.headers) {
        options.headers = options.headers || {};
        extend(options.headers, opts.headers);
      }
    }
  }

  var result;
  try {
    result = await urllib.request(url, options);
  } catch (err) {
    err.name = 'WeChatAPI' + err.name;
    throw err;
  }

  var data = result.data;

  if (data.errcode) {
    var err = new Error(data.errmsg);
    err.name = 'WeChatAPIError';
    err.code = data.errcode;
    throw err;
  }

  return data;
};

/**
 * 获取授权页面的URL地址
 * @param {String} redirect 授权后要跳转的地址
 * @param {String} state 开发者可提供的数据
 * @param {String} scope 作用范围，值为snsapi_userinfo和snsapi_base，前者用于弹出，后者用于跳转
 */
OAuth.prototype.getAuthorizeURL = function (redirect, state, scope) {
  var url = 'https://open.weixin.qq.com/connect/oauth2/authorize';
  var info = {
    appid: this.appid,
    redirect_uri: redirect,
    response_type: 'code',
    scope: scope || 'snsapi_base',
    state: state || ''
  };

  return url + '?' + querystring.stringify(info) + '#wechat_redirect';
};

/**
 * 获取授权页面的URL地址
 * @param {String} redirect 授权后要跳转的地址
 * @param {String} state 开发者可提供的数据
 * @param {String} scope 作用范围，值为snsapi_login，前者用于弹出，后者用于跳转
 */
OAuth.prototype.getAuthorizeURLForWebsite = function (redirect, state, scope) {
  var url = 'https://open.weixin.qq.com/connect/qrconnect';
  var info = {
    appid: this.appid,
    redirect_uri: redirect,
    response_type: 'code',
    scope: scope || 'snsapi_login',
    state: state || ''
  };

  return url + '?' + querystring.stringify(info) + '#wechat_redirect';
};

/*!
 * 处理token，更新过期时间
 */
OAuth.prototype.processToken = async function (data) {
  data.create_at = new Date().getTime();
  // 存储token
  await this.saveToken(data.openid, data);
  return AccessToken(data);
};

/**
 * 根据授权获取到的code，换取access token和openid
 * 获取openid之后，可以调用`wechat.API`来获取更多信息
 * Examples:
 * ```
 * api.getAccessToken(code);
 * ```
 * Exception:
 *
 * - `err`, 获取access token出现异常时的异常对象
 *
 * 返回值:
 * ```
 * {
 *  data: {
 *    "access_token": "ACCESS_TOKEN",
 *    "expires_in": 7200,
 *    "refresh_token": "REFRESH_TOKEN",
 *    "openid": "OPENID",
 *    "scope": "SCOPE"
 *  }
 * }
 * ```
 * @param {String} code 授权获取到的code
 */
OAuth.prototype.getAccessToken = async function(code) {
  var url = 'https://api.weixin.qq.com/sns/oauth2/access_token';
  var info = {
    appid: this.appid,
    secret: this.appsecret,
    code: code,
    grant_type: 'authorization_code'
  };
  var args = {
    data: info,
    dataType: 'json'
  };

  var data = await this.request(url, args);

  return await this.processToken(data);
};

/**
 * 根据refresh token，刷新access token，调用getAccessToken后才有效
 * Examples:
 * ```
 * api.refreshAccessToken(refreshToken);
 * ```
 * Exception:
 *
 * - `err`, 刷新access token出现异常时的异常对象
 *
 * Return:
 * ```
 * {
 *  data: {
 *    "access_token": "ACCESS_TOKEN",
 *    "expires_in": 7200,
 *    "refresh_token": "REFRESH_TOKEN",
 *    "openid": "OPENID",
 *    "scope": "SCOPE"
 *  }
 * }
 * ```
 * @param {String} refreshToken refreshToken
 */
OAuth.prototype.refreshAccessToken = async function (refreshToken) {
  var url = 'https://api.weixin.qq.com/sns/oauth2/refresh_token';
  var info = {
    appid: this.appid,
    grant_type: 'refresh_token',
    refresh_token: refreshToken
  };
  var args = {
    data: info,
    dataType: 'json'
  };

  var data = await this.request(url, args);

  return await this.processToken(data);
};

OAuth.prototype._getUser = function (options, accessToken) {
  var url = 'https://api.weixin.qq.com/sns/userinfo';
  var info = {
    access_token: accessToken,
    openid: options.openid,
    lang: options.lang || 'en'
  };
  var args = {
    data: info,
    dataType: 'json'
  };
  return this.request(url, args);
};

/**
 * 根据openid，获取用户信息。
 * 当access token无效时，自动通过refresh token获取新的access token。然后再获取用户信息
 * Examples:
 * ```
 * api.getUser(options);
 * ```
 *
 * Options:
 * ```
 * openId
 * // 或
 * {
 *  "openId": "the open Id", // 必须
 *  "lang": "the lang code" // zh_CN 简体，zh_TW 繁体，en 英语
 * }
 * ```
 * Callback:
 *
 * - `err`, 获取用户信息出现异常时的异常对象
 *
 * Result:
 * ```
 * {
 *  "openid": "OPENID",
 *  "nickname": "NICKNAME",
 *  "sex": "1",
 *  "province": "PROVINCE"
 *  "city": "CITY",
 *  "country": "COUNTRY",
 *  "headimgurl": "http://wx.qlogo.cn/mmopen/g3MonUZtNHkdmzicIlibx6iaFqAc56vxLSUfpb6n5WKSYVY0ChQKkiaJSgQ1dZuTOgvLLrhJbERQQ4eMsv84eavHiaiceqxibJxCfHe/46",
 *  "privilege": [
 *    "PRIVILEGE1"
 *    "PRIVILEGE2"
 *  ]
 * }
 * ```
 * @param {Object|String} options 传入openid或者参见Options
 */
OAuth.prototype.getUser = async function (options){
  if (typeof options !== 'object') {
    options = {
      openid: options
    };
  }

  var data = await this.getToken(options.openid);

  // 没有token数据
  if (!data) {
    var error = new Error('No token for ' + options.openid + ', please authorize first.');
    error.name = 'NoOAuthTokenError';
    throw error;
  }
  var token = AccessToken(data);
  var accessToken;
  if (token.isValid()) {
    accessToken = token.data.access_token;
  } else {
    var newToken = await this.refreshAccessToken(token.data.refresh_token);
    accessToken = newToken.data.access_token;
  }
  return await this._getUser(options, accessToken);
};

OAuth.prototype._verifyToken  = async function(openid, accessToken) {
  var url = 'https://api.weixin.qq.com/sns/auth';
  var info = {
    access_token: accessToken,
    openid: openid
  };
  var args = {
    data: info,
    dataType: 'json'
  };
  return await this.request(url, args);
};

/**
 * 根据code，获取用户信息。
 * Examples:
 * ```
 * var user = yield api.getUserByCode(code);
 * ```
 * Exception:
 *
 * - `err`, 获取用户信息出现异常时的异常对象
 *
 * Result:
 * ```
 * {
 *  "openid": "OPENID",
 *  "nickname": "NICKNAME",
 *  "sex": "1",
 *  "province": "PROVINCE"
 *  "city": "CITY",
 *  "country": "COUNTRY",
 *  "headimgurl": "http://wx.qlogo.cn/mmopen/g3MonUZtNHkdmzicIlibx6iaFqAc56vxLSUfpb6n5WKSYVY0ChQKkiaJSgQ1dZuTOgvLLrhJbERQQ4eMsv84eavHiaiceqxibJxCfHe/46",
 *  "privilege": [
 *    "PRIVILEGE1"
 *    "PRIVILEGE2"
 *  ]
 * }
 * ```
 * @param {String} code 授权获取到的code
 */
OAuth.prototype.getUserByCode = async function(code) {
  var token = await this.getAccessToken(code);
  return await this.getUser(token.data.openid);
};

module.exports = OAuth;