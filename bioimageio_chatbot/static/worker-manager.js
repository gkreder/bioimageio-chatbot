class PyodideWorkerManager {
  hyphaServices = {}
  workers = {}
  workerApps = {}
  subscribers = []
  workerRecords = {}
  // native file system handle
  constructor(dirHandle, mountPoint) {
    this.workers = {}
    this.workerRecords = {}
    this.dirHandle = dirHandle
    this.mountPoint = mountPoint || "/mnt"
  }

  getDirHandle() {
    return this.dirHandle
  }

  // Subscribe method
  subscribe(callback) {
    this.subscribers.push(callback)

    // Return an unsubscribe function
    return () => {
      this.subscribers = this.subscribers.filter(sub => sub !== callback)
    }
  }

  // Call this method whenever the workers list changes
  notify() {
    this.subscribers.forEach(callback => callback())
  }

  getWorkerApps() {
    // return appInfo
    return Object.values(this.workerApps)
  }

  async createWorker(info) {
    const id = Math.random().toString(36).substring(7)
    console.log("Creating worker:", id)
    const worker = new Worker("./pyodide-worker")
    await new Promise(resolve => (worker.onmessage = () => resolve()))
    this.workers[id] = worker
    this.workerRecords[id] = []
    this.hyphaServices[id] = []
    const self = this
    const appService = {
      id,
      appInfo: info,
      worker,
      async runScript(script, outputContainer) {
        return await self.runScript(id, script, outputContainer)
      },
      async run_script(script, outputContainer) {
        return await self.runScript(id, script, outputContainer)
      },
      async mount(mountPoint, dirHandle) {
        return await self.mountNativeFs(id, mountPoint, dirHandle)
      },
      async render(container) {
        self.render(id, container)
      },
      async close() {
        await self.closeWorker(id)
      },
      getLogs() {
        return self.workerRecords[id]
      },
      get_logs() {
        return self.workerRecords[id]
      },
      async listHyphaServices() {
        return self.hyphaServices[id]
      },
      async list_hypha_services() {
        return self.hyphaServices[id]
      }
    }
    this.workerApps[id] = appService
    if (this.dirHandle) {
      await this.mountNativeFs(id)
    }
    this.notify()
    return appService
  }

  async closeWorker(id) {
    if (this.workers[id]) {
      this.workers[id].terminate()
      delete this.workers[id]
      delete this.workerRecords[id]
      delete this.workerApps[id]
      this.notify()
    }
  }

  async getWorker(id) {
    if (id && this.workers[id]) {
      return this.workers[id]
    } else {
      throw new Error("No worker found with ID: " + id)
    }
  }

  async mountNativeFs(workerId, mountPoint, dirHandle) {
    if (!workerId) {
      throw new Error("No worker ID provided and no current worker available.")
    }
    const worker = await this.getWorker(workerId)
    return new Promise((resolve, reject) => {
      const handler = e => {
        if (e.data.mounted) {
          worker.removeEventListener("message", handler)
          resolve(true)
        } else if (e.data.mountError) {
          worker.removeEventListener("message", handler)
          reject(new Error(e.data.mountError))
        }
      }
      worker.addEventListener("message", handler)
      worker.postMessage({
        mount: {
          mountPoint: mountPoint || this.mountPoint,
          dirHandle: dirHandle || this.dirHandle
        }
      })
    })
  }

  addToRecord(workerId, record) {
    if (!this.workerRecords[workerId]) {
      this.workerRecords[workerId] = []
    }
    this.workerRecords[workerId].push(record)
  }

  renderOutput(container, record) {
    if (record.type === "script") {
      const scriptEl = document.createElement("pre")
      scriptEl.textContent = `Script: ${record.content}`
      container.appendChild(scriptEl)
    } else if (record.type === "stdout" || record.type === "stderr") {
      const outputEl = document.createElement("pre")
      if (record.type === "stderr") {
        outputEl.style.color = "red"
      }
      outputEl.textContent = record.content
      container.appendChild(outputEl)
    } else if (record.type === "service") {
      // display service info
      const serviceEl = document.createElement("div")
      serviceEl.textContent = `Service: ${record.content}`
      container.appendChild(serviceEl)
    } else if (record.type === "audio" || record.type === "img") {
      const el = document.createElement(record.type)
      el.src = record.content
      if (record.attrs) {
        record.attrs.forEach(([attr, value]) => {
          el.setAttribute(attr, value)
        })
      }
      if (record.type === "audio") {
        el.controls = true
      }
      container.appendChild(el)
    }
  }

  async runScript(workerId, script, outputContainer) {
    const worker = await this.getWorker(workerId)
    return new Promise((resolve, reject) => {
      worker.onerror = e => console.error(e)
      const outputs = []
      const handler = e => {
        if (e.data.type !== undefined) {
          this.addToRecord(workerId, e.data)
          outputs.push(e.data)
          if (outputContainer) {
            this.renderOutput(outputContainer, e.data)
          }
          if (e.data.type === "service") {
            this.hyphaServices[workerId].push(e.data.attrs)
          }
        } else if (e.data.executionDone) {
          worker.removeEventListener("message", handler)
          resolve(outputs)
        } else if (e.data.executionError) {
          console.error("Execution Error", e.data.executionError)
          worker.removeEventListener("message", handler)
          reject(outputs)
        }
      }
      worker.addEventListener("message", handler)
      worker.postMessage({ source: script })
      // this.addToRecord(workerId, { type: 'script', content: script });
    })
  }

  render(workerId, container) {
    const records = this.workerRecords[workerId]
    if (!records) {
      console.error("No records found for worker:", workerId)
      return
    }
    records.forEach(record => this.renderOutput(container, record))
  }
}

window.PyodideWorkerManager = PyodideWorkerManager;