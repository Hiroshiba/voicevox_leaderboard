import { createApp } from "vue";
import App from "./App.vue";
import "./style.css";

const app = createApp(App);

app.config.errorHandler = (error, _instance, info): void => {
  console.error("Vue の未処理エラー", { error, info });
};

app.mount("#app");
