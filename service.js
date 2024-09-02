//import Service from 'node-windows'
const Service =require('node-windows').Service
const svc= new Service({
    name:'kologSoft',
    description:'kolog Api',
    script:'./index/js'
})
svc.on('install',()=>{
svc.start()
});

svc.install()