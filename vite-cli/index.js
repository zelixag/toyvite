#!/usr/bin/env node

const Koa = require('koa');
const send = require('koa-send');
const path = require('path')
const { Readable } = require('stream')
const compilerSFC = require('@vue/compiler-sfc')


const app = new Koa();
// 把流转化成字符串

// 因为读取流是异步的，使用Promise来接收
const streamToString = stream => new Promise((resolve, reject) => {
  const chunks = []
  // 读取流，将流数据放入chunks中
  stream.on('data', chunk => chunks.push(chunk))
  // 读完之后将流数据返回
  stream.on('end', () => resolve(Buffer.concat(chunks).toString('utf-8')))
  // 发生错误的话
  stream.on('error', reject)
})

const stringToStream = text => {
  const stream = new Readable;
  stream.push(text);
  stream.push(null);
  return stream;
}

// 3. 加载第三方模块
app.use(async (ctx, next) => {
  // ctx.path --> /@modules/vue
  if(ctx.path.startsWith(`/@modules/`)) {
    // 拿到模块名称
    const moduleName = ctx.path.substr(10);
    // 我们要获取模块的入口文件。也就是esmodules的入口，使用path模块来拼接路径
    // 第一个参数当前项目跟路径，第二个参数node_modules 第三个参数找到模块的package.json文件路径
    const pkgPath = path.join(process.cwd(), 'node_modules', moduleName, 'package.json');
    // 使用require获取模块
    const pkg = require(pkgPath)
    // 第一个参数表示node_modules文件夹下，第二个参数是第三方模块文件夹下，第三个数第三方包的入口文件
    ctx.path = path.join('/node_modules', moduleName, pkg.module)
  }
  await next();
})
// 1. 静态文件服务器
app.use(async (ctx, next) => {
  // 第一个参数上下文，当前请求的路径，当前运行node程序的目录，默认页面
  await send(ctx, ctx.path, {root: process.cwd(), index: 'index.html'})
  await next()
})
// 在获取第三方组件之前，进行处理
// 4. 处理单文件组件
app.use(async (ctx, next) => {
  // 分两次处理单文件组件
  //第一个判断是否是单文件组件
  if(ctx.path.endsWith('.vue')) {
    const contents = await streamToString(ctx.body);
    // 返回一个对象，单文件组件描述对象
    const {descriptor} = compilerSFC.parse(contents)
    let code
    if(!ctx.query.type) {
      code = descriptor.script.content;
      code = code.replace(/export\s+default\s+/g, 'const __script = ')
      code+= `
      import { render as __render } from "${ctx.path}?type=template"
      __script.render = __render
      console.log('haha')
      export default __script
            `
    } else if(ctx.query.type === 'template') {
      // compilerSFC对象里面有一个方法，接受一个对象形式的参数就是编译模板的内容
      const templateRender = compilerSFC.compileTemplate({source: descriptor.template.content})
      code = templateRender.code
    }
    ctx.type = 'application/javascript';
    ctx.body = stringToStream(code);
  }
  await next()
})
// 2. 修改第三方模块的路径
app.use(async (ctx, next) => {
  if(ctx.type === 'application/javascript') {
    // ctx.body的值是一个流，但是我们要把流文件转化为字符串。才能将第三方模块的路径发生改变，而且这个功能其他位置还要用我们抽成一个方法
    const contents = await streamToString(ctx.body);
    // import vue from 'vue'
    // import App from './App.vue' // 浏览器可识别就不处理了
    ctx.body = contents
      // 非获取匹配，正向否定预查，在任何不匹配pattern的字符串开始处匹配查找字符串，该匹配不需要获取供以后使用。例如“Windows(?!95|98|NT|2000)”能匹配“Windows3.1”中的“Windows”，但不能匹配“Windows2000”中的“Windows”。
      // import vue from 'vue' ---> import vue from '/@modules/vue'
      // import db from '../db/index' ---> import db from '../db/index'
      .replace(/(from\s+['"])(?![\.\/])/g, '$1/@modules/')
      .replace(/process\.env\.NODE_ENV/g, '"development"')
  }
})



app.listen(3000);
console.log('Server running @ http://localhost:3000')